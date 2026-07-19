# Global ignore management

Open **Settings → Git → Global ignore** to manage rules that should apply to
every local repository. Desktop Material reads Git's effective
`core.excludesFile`; when none is configured, it proposes a user-level
`.gitignore_global` file without creating or activating it until **Save global
rules** is chosen.

The editor provides optional starter rules for common operating-system and
editor artifacts. Repository `.gitignore` files remain independent, so teams
can continue sharing project rules while personal rules stay outside commits.

## Configuration and safety

- Paths are resolved without a shell and NUL or oversized values are rejected.
- Rule documents are limited to 512 KiB and saved with crash-safe,
  same-directory replacement before Git configuration is changed.
- Linked directories are refused by the persistence layer. A failed file write
  never leaves `core.excludesFile` pointing at an unaccepted replacement.
- The UI reports whether the effective file exists and keeps unsaved text in
  place after an error.

## Failure modes

An unreadable file, directory-valued path, oversized document, configuration
lock, or permission failure is shown in the Global ignore panel. Resolve the
filesystem/configuration issue and choose **Reload** before trying again.

## Verification

`app/test/unit/git/global-ignore-test.ts` covers path resolution, inert default
behavior, write-before-activation ordering, reload, size limits, and binary
input rejection. `app/test/unit/ui/global-ignore-editor-test.tsx` covers load,
starter rules, save success, and retained editor state after failure.
