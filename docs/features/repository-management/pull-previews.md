# Reviewed ordinary Git pull previews

The application-menu **Pull** action and a right click on the toolbar
**Pull _remote_** button are a review boundary for an ordinary,
single-repository Git pull. Desktop Material fetches first, summarizes the
exact current branch and configured upstream snapshot, and waits for
**Pull reviewed commit** before changing the worktree. A plain left click on
the toolbar **Pull _remote_** button performs the pull directly without
opening the review.

## Behavior and configuration

- The preview fetches the current configured remote with the repository's
  bound account, refreshes repository status, and only then reads the
  remote-tracking ref. A failed fetch stops the workflow; it never presents an
  older tracking ref as though it were freshly fetched.
- Git's current fetch path cannot be cancelled safely. While that initial fetch
  is pending, the review is deliberately non-dismissible: it shows no Cancel
  action, and the title-bar close action, Escape key, and backdrop cannot close
  it. Once preparation finishes, **Cancel** dismisses only the displayed
  review. It never claims to cancel Git work that is still running.
- The read-only summary captures the full current-branch ref and object ID,
  the full upstream ref and object ID, and their merge base. It shows shortened
  IDs, ahead/behind counts, the effective fast-forward, merge, rebase,
  merge-preserving rebase, or interactive-rebase route,
  up to 25 incoming commits, and up to 100 incoming changed files. Overflow is
  reported, and the file list compares the merge base with the upstream side,
  so local-only changes are not mislabeled as incoming.
- Confirmation refreshes status again, requires a completely clean worktree,
  and revalidates both refs and both full object IDs. Git then integrates the
  exact reviewed upstream OID already present locally without performing a
  second remote fetch. A remote that advances after review therefore cannot
  add an unreviewed commit to this pull.
- The exact-object pull freezes the reviewed branch-specific and repository
  pull configuration into explicit Git arguments while retaining hooks and
  submodule recursion. The modal review stays open while Git starts and runs,
  preventing an in-app branch switch from changing the accepted destination.
  If application teardown unexpectedly removes the renderer before a confirmed
  pull rejects, the rejection is forwarded to the standard app error handler
  instead of disappearing with the dialog.
- There is no new preference or per-repository switch. The workflow uses the
  checked-out branch's configured upstream, current remote and account binding,
  existing Git pull configuration, and the persisted app language mode.
  English, playful Hong Kong-style Cantonese, and bilingual mode localize the
  title, review labels, warnings, errors, and actions.
- The visible review applies only to the application-menu Pull action and a
  right click on the toolbar Pull button; a left click on that button pulls
  immediately. Scheduled **Automatically pull** runs and explicitly
  noninteractive local-agent pull commands keep their direct automation path
  and existing safety checks; Pull All and reviewed batch sync retain their own
  batch review and result surfaces.

## Failure modes and recovery

A detached HEAD, unborn or otherwise invalid branch, missing configured
upstream, or missing upstream tracking ref produces an unavailable state. A
missing remote, another network operation, authentication/network fetch error,
or failed status refresh stops preparation and offers **Refresh preview**.
Most importantly, a failed fetch invalidates the attempt instead of falling
back to stale remote-tracking data.

Dirty and conflicted worktrees can be inspected, but **Pull reviewed commit**
is disabled. Commit or stash every tracked or untracked change, or resolve all
conflicts, and then refresh. The same clean-worktree check runs again at
confirmation time.

An up-to-date branch has no confirmable incoming commit. If the local branch
OID, upstream ref, or upstream OID changes after review, the prepared snapshot
is cleared and the pull is rejected as stale until a fresh review succeeds.
Invalid `pull.ff`, `pull.rebase`, or branch-specific rebase configuration also
fails closed. A divergent branch configured for fast-forward-only pulls is
shown but cannot be confirmed. Pull or hook failures likewise clear the
accepted snapshot; the reviewed path does not expose the ordinary retry action
because that retry could fetch and integrate a newer, unreviewed remote tip.

## Security considerations

Preview inspection uses fixed Git argument arrays and captured 40- or 64-digit
hexadecimal object IDs, not a shell or editable ref argument. External diff
drivers and text-conversion filters are disabled while collecting changed
paths. Commit and file lists are bounded, file paths are rendered as text, and
only repository-relative incoming paths are shown.

Credential resolution uses the repository's stable account key internally;
tokens and credentials are never included in the review model or UI. The final
operation validates the object ID again and pulls from the local object store,
which closes the network race between review and integration.

Only one pull-preview popup may own the review boundary at a time. A duplicate
request cannot retarget the open modal to another repository or replace its
captured snapshot.

## Verification

Automated Git coverage proves that previewing does not change `HEAD`, the
index, or the worktree; incoming commits and add/modify/delete/rename paths are
bounded correctly; local-only files are excluded; missing/detached/invalid
states fail closed; and changed ref identities are detected. Exact-pull
coverage advances the remote after review and proves that only the reviewed
OID is integrated. Renderer coverage checks the clean-worktree gate, stale
snapshot invalidation and refresh, duplicate-submit suppression, the locked
initial-fetch and confirmed-pull phases, detached-error forwarding, the real
responsive footer group, named keyboard-scroll regions, and all three language
modes. Popup-manager and app-registration contracts verify that the exact
snapshot remains modal and cannot be retargeted.

The publish manifest reserves
`docs/assets/screenshots/material-pull-preview.png` for a future privacy-safe,
exact-source headless acceptance capture. The asset has not yet been accepted,
so published documentation intentionally does not link or render it.
