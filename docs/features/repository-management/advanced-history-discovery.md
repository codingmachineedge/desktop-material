# Advanced history discovery

The History sidebar can search loaded commits by title, body, author, tag, or
full/short object ID using fuzzy, substring, or regular-expression matching.
Its filter chips narrow the result to unpushed, tagged, or signed-in-user
commits, and the graph can be shown or hidden without changing the query.

## Ref scope

The scope selector above search has two explicit modes:

- **Current branch** follows `HEAD`, which is the normal editing history and
  keeps reorder, squash, reset, undo, and amend actions available.
- **All branches & tags** pages commits reachable from local branches, remote
  tracking branches, and tags in topological order. This exposes fetched work
  that is not reachable from the checked-out branch.

All-ref history is discovery-only. History-rewriting controls are disabled so
an interleaved graph from unrelated refs cannot be mistaken for the current
branch's first-parent editing sequence. Read-only inspection, copying, branch
creation, checkout, and cherry-pick remain available through the existing
commit actions.

## Bounds and failure modes

History loads 100 commits per page. A scope switch clears the previous page,
loads the new scope, and only installs the result if the repository and scope
still match the reviewed request. Search progressively requests more pages and
stops after Git returns an empty page.

The all-ref query asks Git for branches, remote-tracking branches, and tags. It
does not traverse reflogs, stash refs, replacement refs, or arbitrary objects.
Remote-only commits appear after a successful fetch; if a network operation
failed, retry fetch and then reopen or refresh History.

## Security and verification

Arguments are fixed Git argv values with no shell interpretation. The feature
does not contact a provider directly and does not change refs or the working
tree.

`app/test/unit/git/log-test.ts` creates a commit reachable only through a
remote-tracking ref and proves it is absent from current-branch history but
present in the bounded all-ref query. `advanced-history-scope-test.ts` covers
scope rendering, stale guards, ref bounds, and the editing-action restriction.
