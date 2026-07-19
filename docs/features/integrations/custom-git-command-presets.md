# Custom Git command presets

Repository Tools provides a controlled extensibility point for commands that
are useful to a team member but too personal or specialized for a permanent
toolbar button. A preset stores a display name, one supported Git built-in, and
its argument string on the current device.

## Behavior and configuration

- Create, edit, and delete up to 50 local presets.
- Quoted arguments are parsed with the platform's native command-line rules.
- Review the exact positional argument preview before every run.
- Stream up to 4 MiB of output, cancel the owned process tree, and refresh the
  repository after completion.
- Presets use bundled Git in the selected repository; they do not select an
  arbitrary executable and never invoke a shell.

The preset editor offers a broad allowlist of non-interactive Git built-ins.
Standard input is closed, so commands that require a prompt or editor fail
instead of waiting invisibly.

## Failure modes and recovery

Malformed persisted entries are ignored. Unsupported subcommands, too many or
oversized arguments, control characters, absolute or parent-traversal paths,
repository-boundary options, and credential-bearing URLs are rejected before
IPC. The main process repeats the same validation. A failing command retains
bounded diagnostics and leaves its result isolated from later runs.

## Security considerations

Custom Git is powerful: allowed built-ins can change worktree files, refs,
remotes, and published history. Every execution therefore requires an explicit
review confirmation and is treated as mutating by the temporary-repository
guard. Users are warned never to store passwords or tokens. The runner uses
`shell: false`, a fixed bundled-Git executable, a real repository working
directory, closed stdin, output and concurrency caps, and exact-process-tree
cancellation.

## Verification

Shared validation tests cover quoted argv, persistence, malformed entries,
unknown/alias commands, boundary-changing options and paths, credential URLs,
extra IPC fields, and confirmation. Renderer tests cover save, review, exact
semantic request, output, refresh, unsafe input rejection, and reviewed delete.
