# External stash interoperability

Desktop Material inventories the newest 500 entries in `refs/stash`, including
stashes created by the Git CLI, another desktop client, or an editor. External
entries carry an **External** badge and sit beside Desktop-managed entries in
the repository stash manager.

## Behavior and configuration

- Apply copy retains the selected stash.
- Restore drops it only after a clean apply.
- New branch delegates to `git stash branch` after validating the branch name.
- Discard and Clear reviewed operate only on the object identities the user
  selected and confirmed.
- Rename or move remains limited to Desktop-managed metadata; Desktop Material
  never rewrites an external stash message.

External branch grouping is recovered from Git's bounded `On branch:` or
`WIP on branch:` subject when available. Unknown formats appear under
`External`. No global configuration is required.

## Failure modes and recovery

The inventory is re-read before every mutation. A missing or replaced object
stops the operation as stale. Apply conflicts retain the stash and refresh the
working tree so the user can resolve Changes. The 500-entry bound is shown in
the UI; after clearing a reviewed batch, refresh to expose older entries.

## Security considerations

Object IDs and branch names are validated before Git runs. Git arguments are
constructed by the application, stash subjects are treated as bounded plain
text, and no stash message becomes a command. Bulk clear is limited to 100
unique reviewed identities per operation.

## Verification

Unit coverage creates a real CLI-authored stash, inventories it as external,
applies it while retaining recovery material, and removes only its reviewed
identity. Renderer coverage verifies the source badge, supported actions, and
the absence of external metadata editing.
