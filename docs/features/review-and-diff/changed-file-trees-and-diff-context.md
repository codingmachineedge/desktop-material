# Changed-file trees and diff context

Desktop Material can organize changed files by directory and remember how much
surrounding text to reveal. Both features are presentation preferences: they do
not modify repository files, Git patches, staging selection, or history.

## Flat and tree file lists

The **Flat** and **Tree** control appears in Changes, commit History, and pull
request changed-file lists. The choice is shared across those surfaces and is
persisted locally. Flat preserves the source list order. Tree uses a stable,
ordinal path sort and depth-first directory ordering.

Tree rows keep the original file objects and identifiers. Selecting, checking,
opening, double-clicking, filtering, and invoking a context menu therefore act
on the same file as in Flat mode. Directory rows are non-selectable. Nested
file rows show a compact basename, while their full Git path remains the
accessible row name and the target for every action.

Git paths are grouped only when they are relative, control-character-free, no
longer than 4,096 characters, no deeper than 128 segments, and contain no
empty, `.` or `..` segment. A path outside those rules remains an ordinary
root-level leaf. The view never resolves paths on disk, so directory grouping
cannot escape the repository or turn a display path into a filesystem action.

## Persisted diff context

Diff Options includes two preferences:

- **Automatically expand whole-file context** opens eligible text diffs with
  all available surrounding lines.
- **Context expansion step** changes manual hunk expansion to 20, 50, or 100
  lines per action.

Automatic expansion is deliberately bounded to complete, expandable files of
at most 2,000 lines and 512 KiB. Partial reads, large files, binary content, or
files that the existing diff loader marks non-expandable stay collapsed and
retain their manual controls. A storage error falls back to the current
session; malformed or unsupported persisted values fall back to automatic
expansion off and a 20-line step.

Changing automatic expansion on while an eligible diff is visible expands it
immediately. Turning the preference off affects subsequent diffs and does not
silently collapse the file currently being reviewed. The existing explicit
collapse action remains available when the current diff owns a restorable
expanded state.

## Languages and accessibility

The controls and directory accessible names update live in English, playful
Hong Kong-style Cantonese, and compact bilingual mode. Flat and Tree are real
pressed-state buttons. Directory rows are skipped by keyboard selection, so
arrow-key navigation, selected-file state, and assistive names continue to
refer to actionable files.

## Verification

Focused unit and UI tests cover deterministic nested ordering, unsafe-path
fallback, source-index preservation for selection/context menu/double-click,
preference persistence and malformed storage, automatic-expansion bounds, and
live English/Cantonese/bilingual switching. Existing text-diff expansion tests
continue to cover hunk merging, top/bottom expansion, and whole-file expansion.
