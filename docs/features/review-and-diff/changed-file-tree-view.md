# Changed-file tree view

Changes, commit History, and pull-request file lists share a persisted
**Flat/Tree** selector. Tree mode groups safe repository-relative paths into a
deterministic depth-first directory hierarchy while preserving each original
file object, identifier, and source index.

Selection, include checkboxes, filtering, context menus, and double-click
editor actions therefore target the same file in either view. Directory rows
are non-selectable and skipped by keyboard navigation. Unsafe, absolute,
control-bearing, traversal, overlong, or overdeep paths remain visible as
root-level leaves and are never resolved on disk.

The selector and directory accessible names update live in English, playful
Hong Kong Cantonese, and compact bilingual mode. A storage failure keeps the
current session usable and falls back to Flat on the next start.

Tests cover nested ordering, unsafe-path fallback, selection/source-index
preservation, menus/double-click, persistence, and all language modes. See
[Changed-file trees and diff context](changed-file-trees-and-diff-context.md)
for the detailed limits.
