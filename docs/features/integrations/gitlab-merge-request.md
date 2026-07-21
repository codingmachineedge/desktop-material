# GitLab merge requests

Desktop Material can create, review, and manage GitLab merge requests natively
for a repository whose selected account is a GitLab or self-hosted GitLab
account, without leaving the app for the provider website. The workspace is
reached from the same branch and pull-request surfaces that host GitHub
pull-request creation; when the repository's bound account is GitLab and the
repository is not a fork, those entry points open the native GitLab
merge-request workspace instead of the browser.

Native handling is deliberately scoped. `getPullRequestInteractionRoute` returns
`gitlab-native` only for a non-fork GitLab repository. GitLab forks and Bitbucket
repositories still route to a provider composer URL in the browser, and GitHub
repositories keep their existing native pull-request flow.

## Behavior

The workspace covers the merge-request lifecycle against the bound project:

- **List** open, closed, merged, locked, or all merge requests for the project,
  ordered by created or updated time.
- **Create** a merge request from the published current branch to a chosen
  target branch, with a title, description, draft flag, and reviewer and
  assignee selections drawn from the project's members.
- **Load** a single merge request together with its all-tier approval state and
  a computed readiness summary (`ready`, `checking`, `blocked`, or `unknown`)
  derived from GitLab's detailed merge status, conflict flag, and blocking
  discussion state.
- **Update** title, description, target branch, draft state, reviewers, and
  assignees; **close** or **reopen**; and **approve** or **unapprove** when the
  GitLab instance exposes approvals.

Draft state is carried through GitLab's title-prefix convention. The model
strips `Draft:`, `WIP:`, `[draft]`, and `(draft)` prefixes before validation and
re-applies a single `Draft: ` prefix when the draft flag is set, so the visible
title and the draft toggle stay consistent.

Branch names offered in the composer are derived only from refs associated with
the exact remote. The source is the published current branch, and the target
list is bounded by the renderer model.

## Configuration

The feature needs no separate setup beyond a signed-in GitLab account bound to
the repository. Availability is computed from the repository and its accounts
and reports one of `available`, `signed-out`, `not-gitlab`, `no-remote`, or
`endpoint-mismatch`. It is `available` only when the repository has a hosted
remote, the account selected for the repository is a signed-in GitLab account,
and that account's endpoint canonicalizes to the same GitLab API endpoint as the
repository remote. A missing or mismatched binding fails closed instead of
selecting a different identity.

All request and mutation payloads are bounded before they leave the renderer:
a title up to 1,024 characters, a description up to 1 MiB, branch names up to
255 characters, a project path up to 512 characters, at most 100 reviewers or
assignees, and at most 10 pages of 100 items (1,000 merge requests or members)
per collection.

## Failure modes and recovery

- **Bounded, provider-safe errors.** Every failure surfaces as a typed
  `GitLabMergeRequestError` whose kind is one of authentication, permission,
  not-found, conflict, validation, rate-limit, service, network,
  invalid-response, outcome-unknown, or unsupported. The error never retains a
  response body or credential.
- **Context changes.** If the selected account, repository, or reviewed merge
  request changes while a request is in flight, the operation raises a
  `GitLabMergeRequestContextChangedError` and the caller refreshes instead of
  applying a stale result. A request gate supersedes older read generations even
  when the underlying work ignores its abort signal.
- **Unconfirmed mutations.** When a create, update, state change, approve, or
  unapprove request fails in transport, or its response cannot be read or
  parsed, the operation raises a
  `GitLabMergeRequestMutationOutcomeUnknownError`. GitLab may already have
  applied the change, so the workspace asks the user to refresh before retrying
  rather than silently repeating a possibly-successful mutation.
- **Invalid provider metadata.** Inconsistent pagination headers (`x-next-page`,
  `Link`, `x-page`, or `x-per-page` values that disagree) are rejected as an
  invalid response instead of being followed.
- **Illegal transitions.** A close is refused unless the merge request is open,
  a reopen unless it is closed, and any change to a merged request is refused
  before a request is sent.

## Security considerations

- **Exact-account binding.** The store resolves the account through the
  repository's stable account key and refuses to act if the resolved account is
  not the bound GitLab identity or its endpoint does not match the repository
  server. The account context is re-checked after each request completes.
- **Reviewed mutations.** A mutation must present a mutation-review token that
  the store issued for the exact merge request the user was viewing. The token
  records the repository fingerprint, account key, account generation, project,
  merge-request IID, reviewed HEAD SHA, and reviewed update timestamp, and it is
  validated against the current context before any write.
- **Concurrency guards.** Updates and state changes preflight the reviewed HEAD
  SHA and update timestamp against a fresh read and abort on drift. Because
  GitLab exposes no conditional-update field, this is a preflight check and not
  atomic optimistic locking, so the workspace still refreshes on an unknown
  outcome. Approvals send the reviewed HEAD SHA to GitLab's `approve` endpoint,
  which GitLab rejects atomically when the reviewed SHA no longer matches.
- **Credential handling.** The GitLab token is sent only as the `PRIVATE-TOKEN`
  request header. The non-secret workspace route exposes the account key, user
  id, login, display name, friendly endpoint, provider HTML URL, and project
  path, never the token, and canonical merge-request and composer URLs are built
  only from that route and validated to stay on the account's origin with no
  embedded credentials, query, or fragment.
- **Bounded responses.** Every response body is size-bounded before parsing, and
  parsed values are validated against the typed model.

## Language and accessibility

All workspace labels, status messages, confirmations, and accessible names use
the app's persisted **English**, playful **Hong Kong Cantonese**, or
**English / 香港粵語** bilingual mode with English fallback.

## Verification

The feature arrives from `origin/codex/report-gitlab-integration`, which merges
into the current `main` with zero conflicts. Its focused `node:test` /
`node:assert` unit tests cover:

- the bounded model, validators, draft-prefix normalization, and readiness
  computation (`gitlab-merge-request-test.ts`, `merge-request-model-test.ts`);
- the native `GitLabAPI` methods, bounded pagination, mutation settling, and
  outcome-unknown handling (`gitlab-merge-request-api-test.ts`);
- the account-bound store's availability, abort and stale-response gates,
  provenance, and mutation-review enforcement
  (`gitlab-merge-request-store-test.ts`);
- the workspace router, interaction-route selection, and branch-context builders
  (`gitlab-merge-request-workspace-test.ts`,
  `gitlab-merge-request-app-routing-test.ts`);
- the workspace UI editor, lifecycle, and dialog, plus their i18n and style
  contracts (`merge-request-editor-test.tsx`,
  `merge-request-lifecycle-test.tsx`, `ui/gitlab-merge-request-dialog-test.tsx`,
  `merge-request-editor-i18n-test.ts`, `merge-request-editor-style-test.ts`);
  and
- an env-gated live-fixture lifecycle exercise against a deterministic loopback
  GitLab fixture (`gitlab-merge-request-live-fixture-test.ts`), which stays
  skipped unless `DESKTOP_MATERIAL_GITLAB_MR_LIVE_ENDPOINT` and
  `DESKTOP_MATERIAL_GITLAB_MR_LIVE_PROJECT` are set.

Because this checkout has no installed dependency tree or off-screen build
environment, the production build, screenshot capture, and remote CI/Pages
receipts for this feature are not claimed here. They remain pending the branch's
merge, build, and pushed-SHA verification on `main`.
