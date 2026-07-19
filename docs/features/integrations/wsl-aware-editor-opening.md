# WSL-aware editor opening

On Windows, installed Visual Studio Code editions gain one editor choice per
detected Windows Subsystem for Linux distribution, for example
`Visual Studio Code — WSL: Ubuntu`. The choices work as global defaults and as
repository-specific editor overrides anywhere Desktop Material already offers
Open in editor.

## Behavior and configuration

Desktop Material discovers up to 32 unique distributions through
`wsl.exe --list --quiet`. When a WSL editor is selected, a normal Windows path
is translated with that exact distribution's `wslpath`; a
`\\wsl.localhost\Distro\...` or `\\wsl$\Distro\...` path is mapped directly.
Visual Studio Code then receives its remote target and Linux path as separate
arguments. The selection persists through the existing editor setting or
per-repository override.

## Failure modes and recovery

Unavailable WSL installations simply add no choices. Discovery and translation
have five-second and 64 KiB bounds. A stopped distribution, missing path
translator, invalid result, or UNC share belonging to another distribution
produces an editor error with recovery guidance; choose the matching entry or
start the distribution and retry.

## Security considerations

No shell parses a repository path or distribution name. The application starts
`wsl.exe` and the editor with positional argument arrays, rejects control
characters and oversized values, bounds captured output, and requires
cross-distribution UNC paths to be selected explicitly.

## Verification

Unit coverage exercises UTF-8 and UTF-16LE discovery output, name
deduplication, UNC mapping and mismatch rejection, exact `wslpath` arguments,
VS Code remote arguments, invalid names, and malformed translated paths.
