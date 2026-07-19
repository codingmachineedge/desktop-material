# Patch-series exchange

Open **Repository → Repository tools → Exchange patch series** to move a
reviewable sequence of commits without publishing a branch.

For export, choose a new destination. Desktop Material reviews the final
`.patches` folder and then runs a fixed `git format-patch` recipe for commits
ahead of the configured upstream. Existing destinations are rejected.

For import, choose between 1 and 256 `.patch` files in apply order. After review,
the app runs `git am` with three-way fallback and preserves CRLF. If Git stops
on a conflict, resolve files in **Changes**, then choose **Continue**, **Skip
patch**, or **Abort import** from the same panel.

## Safety and failure modes

- The renderer sends semantic operation IDs and bounded values; only the main
  process constructs Git arguments. There is no shell or editable command line.
- Imports accept only distinct absolute regular files, at most 16 MiB each and
  64 MiB total. Exports cannot enter `.git` or replace an existing path.
- Every write requires the reviewed request, repository identity, and main-owned
  confirmation policy. Temporary submodule workspaces remain read-only.
- Cancellation targets only the current run. A failed import retains explicit
  recovery actions and refreshes the repository after successful recovery.

## Verification

The semantic registry and injection boundaries are covered by
`app/test/unit/cli-workbench-operation-registry-test.ts`. The production UI,
ordering review, conflict recovery, cancellation, and pre-start failure paths
are covered by `app/test/unit/ui/repository-patch-series-test.tsx` and the
Repository Tools registration tests.
