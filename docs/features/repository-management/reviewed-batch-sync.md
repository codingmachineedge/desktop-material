# Reviewed batch repository sync

The repository picker exposes **Sync repositories** for workspace-scale network
updates. The dialog loads the current persisted repositories, selects all by
default, and lets the user review an exact subset before starting either a pull
or a fetch-only batch.

## Behavior and configuration

- **Pull active branches** refreshes each repository, requires an active branch
  with an upstream, and uses the existing account-aware pull path.
- **Fetch only** fetches relevant remotes and leaves each worktree unchanged.
- Select all and Select none make large workspaces quick to review.
- Up to three repositories run concurrently. The non-modal progress surface can
  run in the background and preserves isolated success, skip, and failure rows.

No persistent scheduler setting is created; every batch is explicitly reviewed.

## Failure modes and recovery

Missing repositories, missing remotes, detached or unborn branches, branches
without upstreams, and already-running network operations are skipped with a
per-repository reason. Authentication and network failures affect only that
row. If the repository inventory changes between review and execution, the
batch stops before any selected operation begins and asks for a refresh.

## Security considerations

The renderer submits only the operation enum and bounded numeric repository
IDs. The store re-resolves every ID against the live persisted inventory and
rejects duplicates, invalid IDs, empty selections, more than 500 entries, or a
stale set. No remote URL, refspec, credential, or raw Git argument crosses the
review boundary.

## Verification

Automation coverage checks bounded concurrency, ordered isolated results, and
distinct fetch progress. Renderer coverage checks the review gate, subset
selection, fetch-only semantics, background continuity, and completion/failure
summaries.
