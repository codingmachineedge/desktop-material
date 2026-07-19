# Selective stashes

The Stash Manager can save all working-tree changes or only an explicitly
reviewed set of changed files. Selected scope operates on whole paths: it does
not imply partial-line selection, and the confirmation lists the exact files
that will be passed to Git.

Paths are repository-relative, unique, and bounded to 500 entries and 64 KiB
of aggregate path text. Absolute paths, traversal, controls, and paths outside
the repository are rejected. Git receives paths after `--`, with no shell
interpretation. The selected set is rechecked against working-directory state
before creation.

Untracked and tracked changes follow Git's stash semantics shown by the review
surface. An empty selection, unborn or conflicted repository, in-progress
operation, changed selection, or Git failure leaves the working tree visible
and reports that no reviewed stash was created.

Verification is in `git/stash-test.ts` (including a real selected-path fixture)
and `ui/stash-manager-test.tsx`.
