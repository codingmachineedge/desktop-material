# Repository sidebar and pinning

The repository sheet is a searchable workspace switcher rather than a flat
recent list. It groups pinned repositories first, can show or hide the Recent
group, and keeps account/provider/status filters independent so local-only,
signed-out, and unavailable-account repositories are not misclassified.

Each row exposes repository status and a context menu for pin/unpin, local
hide/unhide, editor, Explorer/Finder, and removal workflows. Hidden repositories
remain registered and can be recovered through **Show hidden**; hiding never
deletes a working tree or alters Git state. Missing or cloning repositories are
labelled instead of being treated as clean.

Pin, group, alias, visibility, and filter settings are local UI metadata. Stable
repository IDs prevent a path-label change from silently moving the setting to
another repository. Switching uses the application's normal repository state
guards and does not start a Git mutation.

Verification lives in `repositories-list-grouping-test.ts`,
`repository-list-visibility-test.ts`,
`repository-list-context-menu-test.ts`, and the repository-list filter/style
suites.
