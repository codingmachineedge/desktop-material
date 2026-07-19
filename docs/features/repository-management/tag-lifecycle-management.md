# Tag lifecycle management

Desktop Material's **Repository tools → Tag lifecycle** surface manages local
and remote Git tags without an editable command line. It provides a bounded
inventory, creation and recreation, signing, push, fetch/prune, and reviewed
deletion in one workflow.

## Behavior

- The initial inventory is local-only, capped at 500 rows and 4 MiB of parsed
  output. **Load remote** explicitly performs the network request against the
  repository's default remote and correlates local and remote ref objects.
- **Create local tag** supports lightweight tags and annotated tags with a
  message. Annotated tags can use Git's configured OpenPGP, SSH, or X.509
  signer. The surface reports the configured format and lets Git surface a
  missing-key or signer failure normally.
- **Move** recreates a tag at a reviewed target and can change its lightweight,
  annotated, message, or signing settings. Confirmation requires the tag name.
  Immediately before the update, Desktop Material compares the current exact
  ref object with the reviewed object and rejects a stale review.
- **Push** supports one reviewed tag or every local tag. Remote inventories
  identify pushed, local-only, divergent, and remote-only rows.
- **Fetch tags** adds remote tags locally. **Fetch and prune** also removes
  local tags that the remote no longer advertises and therefore requires the
  explicit `PRUNE` phrase.
- Local deletion never silently deletes the remote copy. Both local deletion
  and push revalidate every exact reviewed local ref object. Push-all is
  unavailable when the bounded inventory is truncated, so undisplayed tags are
  never swept into the operation. A moved tag can replace its remote counterpart
  through an explicit object-specific force-with-lease; a concurrent remote
  replacement is rejected. Remote deletion is a separate reviewed action that
  re-queries the exact remote ref object before sending its fixed deletion
  refspec.

All mutation controls are disabled in a temporary submodule workspace. The
application store repeats its temporary-workspace safety check at the final
asynchronous boundary.

## Configuration

The manager uses the repository's default remote. A repository without a
remote can still inventory, create, move, and delete local tags; remote controls
stay unavailable. Signing follows normal Git configuration, including
`user.signingkey` and `gpg.format`; no key material is stored by Desktop
Material.

## Failure modes

- Invalid ref names, option-like names, oversized fields, malformed object IDs,
  duplicate push selections, and inventories above the display limit fail
  closed before mutation.
- An unknown target fails during exact object resolution. A signing failure
  leaves the existing tag unchanged.
- Move, local-delete, push, and remote-delete confirmations fail when another
  tool changes the tag after review. Prune similarly revalidates the complete
  local inventory. Reload and review the new objects before trying again.
- Authentication, network, hook, branch-protection, and remote-permission
  errors use the normal application error presentation. A partial remote
  failure is never reported as success.
- Pruning depends on Git's `--prune-tags` support. Older Git versions report an
  actionable command error and do not run an alternate raw command.

## Security considerations

The renderer submits typed operations, not executable names, argv arrays, shell
text, or arbitrary refspecs. Tag names are length-bounded and checked with
`git check-ref-format`; targets resolve to full object IDs before mutation.
Remote names come from the repository store and are validated against option
confusion. Network commands receive credentials only through the existing
remote-operation environment and never render remote URLs or secrets.

Destructive operations use typed confirmation phrases. Remote deletion and
local recreation carry exact reviewed object IDs so a stale screen cannot
silently act on a replacement tag.

## Verification

Focused Git tests cover lightweight and annotated inventory, messages, create,
stale-safe move, single/all push, fetch/prune, and stale-safe remote deletion
against local fixture remotes. UI tests cover local-first loading, signing and
creation fields, filtered inventory status, move review, typed confirmations,
push-all review, remote-only deletion, and read-only temporary-workspace
controls.

This feature adds no HTTP endpoint, so a Postman collection is not applicable.
