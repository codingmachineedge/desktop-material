# Native pull request review workspace

## Behavior

Open a pull request's context menu and choose **Manage Pull Request…** to load a
single account-bound workspace. The summary remains visible while five
keyboard-accessible tabs organize the workflow:

- **Overview** edits the title, description, base branch, requested reviewers,
  assignees, and labels. It also confirms close/reopen and merge actions.
- **Files** shows per-file change totals and the bounded patch returned by
  GitHub. A pending inline comment records an exact file path, line, and old or
  new diff side.
- **Commits** lists the bounded commits for the pull request head.
- **Conversation** combines reviews, issue comments, inline review comments,
  and replies into a chronological timeline. It holds the pending review queue
  and supports Comment, Approve, and Request changes submissions.
- **Checks** reuses Desktop Material's consolidated status/check-run cache for
  the exact head commit.

The summary reports item counts. If GitHub advertises more than six 50-item
pages for a collection, the workspace marks that collection as capped and
directs the user to GitHub for the remainder.

## Provider requests

The workspace reads these GitHub REST collections independently with
`per_page=50`, a maximum of six pages, and a one-megabyte JSON limit per
response:

- `GET /repos/{owner}/{repo}/pulls/{number}/files`
- `GET /repos/{owner}/{repo}/pulls/{number}/commits`
- `GET /repos/{owner}/{repo}/pulls/{number}/reviews`
- `GET /repos/{owner}/{repo}/issues/{number}/comments`
- `GET /repos/{owner}/{repo}/pulls/{number}/comments`

Review submission uses `POST /pulls/{number}/reviews` with the inspected
`commit_id` and at most 25 combined inline comments and replies. Replies are
then sent to `POST /pulls/{number}/comments/{comment_id}/replies`. Close and
reopen use the documented `state` field on `PATCH /pulls/{number}`. Ready for
review and convert to draft remain browser actions because the bounded REST
contract does not expose GitHub's GraphQL-only mutations.

## Configuration

No feature flag is required. The selected account must be a signed-in GitHub
account whose endpoint exactly matches the pull request's base repository. The
repository must not be archived for mutation. Checks appear when the existing
commit-status service has results for the head SHA.

## Failure modes

- A repository, account, pull request, or head-SHA change rejects the operation
  and requires a refresh.
- Invalid or oversized JSON, collection items, pagination links, paths, dates,
  patches, comment bodies, line numbers, and identifiers fail closed.
- A missing patch is shown neutrally because GitHub can omit binary or oversized
  patches.
- An outdated inline comment remains in the timeline without inventing a
  current line number.
- Review submission happens before queued replies. If a reply fails after the
  review succeeds, Desktop Material preserves the successful review, reports
  the exact bounded reply identifier that failed, and does not retry
  automatically.
- If any mutation succeeds but the follow-up workspace refresh fails, the
  success is reported and the old workspace is removed so the action cannot be
  repeated from stale UI.
- A capped collection remains explicitly incomplete; it is never presented as
  the full provider history.

## Security considerations

Every read and mutation is routed through the exact base repository and matching
account endpoint. Workspace data is revalidated before and after the parallel
collection reads. Mutations require the most recently inspected head SHA, and
the store checks inline paths and reply identifiers against that head's loaded
workspace before transport. Provider response bodies are not echoed into error
copy. Patches are display-only and never written to the worktree.

## Verification

Focused tests cover parser bounds and path rejection, strict pagination,
pre/post head checks, account-scoped store caching, stale inline/reply rejection,
review payload anchoring, close/reopen state, accessible dialog tabs, pending
queue confirmation, checks fallback, responsive patch scrolling, and the
deterministic guided-proof fixture routes.
