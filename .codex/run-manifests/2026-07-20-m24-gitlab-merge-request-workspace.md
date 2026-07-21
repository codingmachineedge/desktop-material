# GitLab Merge Request Workspace — M24 Run Manifest

## Mode and isolation

- Mode: `implement` while the M23 Ollama owner retains `main`
- Milestone: M24 — native GitLab merge request lifecycle
- Product boundary: Windows x64/arm64 application only
- Expected integration branch: `codex/report-gitlab-integration`
- Implementation branches: `codex/report-gitlab-core`,
  `codex/report-gitlab-ui`, and `codex/report-gitlab-fixture`
- Isolation rule: do not modify `main`, any `codex/ollama-*` branch, or any
  Ollama worktree until the explicit M23 owner releases them

## Expected product state

An authenticated GitLab account bound to the current repository can create and
manage a merge request without a browser pivot. The workspace supports source
and target branches, title, description, draft state, reviewers, assignees,
close/reopen, approval state, HEAD-SHA-guarded approve/unapprove actions, and a
plain-language merge-readiness summary based on `detailed_merge_status`.

Every request is scoped to the repository's exact account and self-managed
endpoint. Project paths and merge-request IIDs are encoded and bounded. Lists,
strings, pagination, response bodies, and error surfaces are bounded; provider
response bodies and credentials are never surfaced. Aborted or stale requests
cannot replace a newer repository, account, branch, or merge-request context.

## UI and accessibility contract

- Create/edit form: source, target, title, description, draft, reviewers, and
  assignees with required-field and duplicate-selection validation
- Lifecycle summary: open/closed/merged/draft state, author, reviewers,
  assignees, approval progress, pipeline/readiness blockers, and updated time
- Actions: create, save, close/reopen, approve/unapprove, refresh, and open the
  canonical GitLab URL
- States: loading, empty, partial, unavailable, stale, submitting, success,
  canceled, and failure
- Keyboard/focus semantics, reduced motion, narrow-window responsiveness, and
  stable `data-verification` hooks
- All new visible and accessibility strings in typed English and 香港粵語

## Deterministic acceptance

1. Start an owned loopback GitLab v4 fixture with a unique Temp run root.
2. Prove exact `PRIVATE-TOKEN` authentication without logging the token.
3. Exercise bounded pagination, create, edit, draft, reviewer/assignee,
   close/reopen, approval/readiness, error, malformed, partial, cancellation,
   and mutation-log paths.
4. Build and navigate only through the low-level MCP off-screen Windows flow.
5. Capture one identity-safe overview after the final integration is released
   to the owning publication task.
6. Stop only owned PIDs and delete only verified owned Temp paths.

## Declared validation

- Focused GitLab API, parser, store, UI, style, i18n, fixture, and contract tests
- Adjacent GitHub pull-request and generic provider regressions
- TypeScript `--noEmit`, targeted ESLint, Prettier, and `git diff --check`
- Exact-route/auth/pagination/cancellation/mutation assertions
- Secret, personal-data, conflict-marker, and endpoint-leak scans
- Feature-branch pushes only until the M23 owner releases `main`

