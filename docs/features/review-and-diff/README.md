# Review and diff features

This category documents in-app presentations for safely reviewing repository
changes without changing Git's underlying patch or selection behavior.

## Features

- [Changed-file tree view](changed-file-tree-view.md)
- [Expanded diff context](expanded-diff-context.md)
- [Structured CSV and TSV diffs](structured-csv-and-tsv-diffs.md)
- [TGA image previews](tga-image-previews.md)
- [Structured data and TGA previews](structured-data-and-tga-previews.md) —
  review bounded CSV/TSV changes as an accessible table and supported TGA
  images as ordinary image diffs, with deterministic fallback behavior.
- [Changed-file trees and diff context](changed-file-trees-and-diff-context.md)
  — organize nested changed paths without changing file actions, and persist
  bounded context-expansion preferences.

## API applicability

These features operate on local file and Git blob contents. They add no HTTP
endpoint, so a Postman collection is not applicable.
