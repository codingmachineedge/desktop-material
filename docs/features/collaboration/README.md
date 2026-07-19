# Collaboration features

This category documents provider-backed workflows that let contributors review
and manage collaboration state without leaving Desktop Material.

## Features

- [Checkout branches from other forks](fork-branch-checkout.md) — discover a
  bounded GitHub repository network, review an exact fork branch head and
  Desktop-managed ref, then fetch and checkout with stale-state guards.
- [Native pull request creation](pull-request-creation.md) — discover bounded
  repository templates, review title/body/draft and provider-backed metadata,
  then create through the exact authenticated GitHub account and local head.
- [Native pull request review workspace](pull-request-review-workspace.md) —
  inspect a bounded, exact-head pull request workspace; review files, commits,
  conversation, and checks; queue inline comments and replies; submit a review;
  and close, reopen, or merge with explicit confirmation.
- [Rich pull-request context and
  actions](pull-request-context-and-actions.md) — keep exact head/base context,
  metadata, checks, timelines, and guarded lifecycle actions in one workspace.
- [Pull-request activity
  notifications](pull-request-activity-notifications.md) — route relevant
  reviews, comments, and failed checks through de-duplicated OS notifications.
- [Offline GitHub Projects workspace](offline-github-projects.md) — inspect a
  bounded read-only Projects v2 snapshot, with a capability-aware classic
  fallback and a sanitized per-repository cache for offline recovery.

## API applicability

The workspace consumes authenticated GitHub REST endpoints through the existing
account-bound client. It does not expose an application HTTP endpoint, so a
Postman collection is not applicable. The provider routes and payload limits
are documented with the feature instead.
