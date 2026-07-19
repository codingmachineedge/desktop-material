# Rich pull-request context and actions

The pull-request workspace keeps the exact base/head repository, branch, head
object ID, author, draft/state, mergeability, checks, files, commits, reviews,
issue comments, and inline conversation in one repository-bound surface.

Overview actions can edit title/body/base and provider metadata, close or
reopen, and merge with an explicit strategy/confirmation when the provider
reports that action as available. Files retain bounded patches and exact old/new
line sides; Conversation orders reviews, issue comments, inline comments, and
replies without flattening their provider identities. Checks reuse the exact
head-SHA status cache.

Each collection has a page and response-size cap. Permission, archived repo,
unsupported API, draft/merge restrictions, and partial collection failures are
shown as capabilities rather than hidden controls. A repository, account, PR,
or head-SHA change invalidates mutation review. Successful mutations are not
reported as failed merely because the follow-up refresh stopped; stale data is
discarded instead.

All provider calls use the exact repository-bound account and validated IDs.
Patch text is display-only and never applied to the worktree. Error copy does
not echo response bodies or credentials.

Detailed endpoints, bounds, and verification are in
[Native pull request review workspace](pull-request-review-workspace.md).
