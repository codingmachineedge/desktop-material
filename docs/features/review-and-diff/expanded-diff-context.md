# Expanded diff context

Diff Options can automatically reveal whole-file context for eligible text
diffs and can set manual expansion steps to 20, 50, or 100 lines. The preference
is local presentation state and never rewrites a patch, staging selection, or
working file.

Automatic expansion requires a complete expandable file no larger than 2,000
lines and 512 KiB. Partial reads, binary/large files, and non-expandable diffs
stay collapsed. Enabling it affects the visible eligible diff immediately;
disabling it does not silently collapse what the user is reviewing, and the
explicit collapse action remains available.

Malformed storage falls back to automatic expansion off and a 20-line step.
Controls update live in English, playful Hong Kong Cantonese, and bilingual
mode. Tests cover bounds, persistence, hunk merging/expansion, immediate
updates, collapse, and localization. More detail is in
[Changed-file trees and diff context](changed-file-trees-and-diff-context.md).
