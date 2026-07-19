# Reviewed bulk branch deletion

The Branches side sheet includes a compact cleanup panel for removing several
local branches in one reviewed batch. Current, default, and remote-only branches
never enter the candidate list.

## Behavior and configuration

- Select individual local branches, Select all, or Select none.
- Review up to 100 exact branch names and tip object IDs per batch.
- Confirm once, then receive an isolated result and recovery SHA for every
  branch.
- Remote branches and upstreams are never changed by this bulk workflow.

There is no persistent configuration. Single-branch deletion and its optional
upstream behavior remain available from the normal branch context menu.

## Failure modes and recovery

The complete inventory is revalidated before the first mutation. If any branch
was deleted or moved after review, or is checked out in any linked worktree,
nothing starts and the panel asks for a fresh review. Each subsequent deletion
includes its expected old object ID, so a later race fails that row instead of
deleting the new tip. Failed rows remain listed; successful rows record the
12-character recovery ID.

## Security considerations

Branch names and full SHA-1/SHA-256 object IDs are bounded and validated. The
current and default branches are protected again in the store, not only hidden
by the renderer. Git's worktree inventory protects branches checked out in the
main or any linked worktree. The operation uses Git's exact
`update-ref -d REF OLD-OID` contract inside the repository mutation guard and
never executes a shell or deletes a remote ref.

## Verification

Real-repository tests cover exact multi-delete, current-branch and linked
worktree preservation, recovery identities, and all-before-any stale review
rejection. Renderer tests cover protected candidate filtering, exact reviewed
requests, confirmation, results, and stale failures.
