# Guided sparse checkout

Desktop Material manages cone-mode sparse checkout through a three-step
**Choose/Adjust/Restore → Review selection → Apply and refresh** guide. The
workflow changes which tracked paths Git materializes in the current working
tree; it does not change commits or repository history.

## Behavior

1. **Choose/Adjust/Restore** detects the current sparse-checkout state and
   accepts one repository-relative directory root per line. The guide calls
   this step Choose, Adjust, or Restore according to whether sparse checkout is
   disabled, already using cone mode, or using an existing non-cone
   configuration.
2. **Review selection** freezes the editor and shows every bounded, normalized
   selection entry that will be sent to Git. A first-time enable reports the
   number of selected roots. An update to an enabled cone-mode selection also
   separates added, removed, and unchanged roots. These are selection-entry
   changes, not a prediction of individual local files; cone mode may retain
   required parent files.
3. **Apply and refresh** runs the reviewed operation, offers cancellation while
   Git is changing the worktree, and refreshes both the repository and
   sparse-checkout state afterward. The guide retains this result phase after
   success, cancellation, or failure so that the outcome does not visually jump
   back to Choose/Adjust/Restore. Editing the selection or requesting a manual
   refresh begins a new pass.

The guidance beneath the editor follows the current state. It distinguishes an
empty selection, invalid input, a selection ready for review, a frozen review,
an operation in progress, and a completed result. Reapply and disable also use
reviewed confirmation steps. Disabling restores the full tracked working tree.
The three-step guide occupies a dedicated region above the scrollable editor
and review body, so it remains visible without covering content. At compact
widths, its steps stack within the sheet instead of forcing horizontal overflow.

## Configuration and limits

- Cone-mode selections contain at least one and at most 1,000 unique directory
  roots.
- Each entry is limited to 4,096 characters, and the complete input is limited
  to 256 KiB.
- Leading and trailing whitespace is removed, backslashes are changed to
  forward slashes, repeated slashes are collapsed, and trailing slashes are
  removed before review.
- Git 2.25 or newer is required. Existing non-cone patterns are displayed but
  cannot be edited by this manager; review **Disable sparse checkout** first,
  then create a cone-mode selection.
- A linked-worktree badge makes that repository state visible. All mutations
  still pass the same physical worktree-path safety checks as other guarded
  worktree operations.

## Failure modes and recovery

The review action stays unavailable until the normalized selection is valid.
Absolute paths, `.` or `..` traversal segments, option-looking values, control
characters, empty lines, duplicates, and over-limit input are rejected with
line-specific guidance.

Mutation is blocked for an unsupported Git runtime, an unborn repository, a
submodule that must be managed from its parent, an unsafe worktree path, or an
incompatible non-cone state. Desktop Material fetches fresh state again at the
mutation boundary, so a stale review cannot silently bypass those checks. A Git
failure, cancellation, repository refresh failure, or state refresh failure is
reported in the retained Apply/result phase. The app does not claim a refresh
succeeded when it did not.

## Security considerations

The normalized reviewed roots are passed to
`git sparse-checkout set --cone --stdin`; they are never interpolated into a
shell command. Input and Git output are bounded, the repository identity is
rechecked across asynchronous work, and physical worktree guards run directly
before mutation. Closing is disabled while Git is mutating the worktree, while
the explicit cancellation control remains available. This local Git workflow
does not collect credentials or call a provider API.

## Verification

Parser normalization and limits are covered by
`app/test/unit/git/sparse-checkout-parser-test.ts`. Git state detection,
physical-path guards, mutation arguments, and cancellation are covered by
`app/test/unit/git/sparse-checkout-test.ts`. The guided phases, exact review
list, state-aware messages, retained result state, focus, and cancellation are
covered by `app/test/unit/ui/sparse-checkout-test.tsx`; static markup and style
contracts, including the persistent non-overlapping guide region, are covered
by `app/test/unit/sparse-checkout-ui-test.ts`.

The Windows headless acceptance workflow also exercises the production dialog
and records the sparse-checkout gallery evidence without using the visible
desktop.

## HTTP API and Postman applicability

Not applicable. Sparse checkout is a local renderer/dispatcher/Git workflow and
adds no HTTP endpoint, so there is no Postman collection for this feature.
