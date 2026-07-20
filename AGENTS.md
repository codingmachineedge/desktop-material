# Repository agent instructions

## Windows-only product boundary

- Desktop Material is a Windows-only application. Support, build, packaging,
  runtime, and end-to-end acceptance work targets Windows only.
- Keep Windows x64/arm64 CI, Windows x64 packaged E2E, and the Windows x64
  installer/release path healthy. Do not add or require macOS/Linux app jobs,
  packages, compatibility work, or release blockers unless the user explicitly
  changes the product boundary.
- Non-Windows runners may host platform-neutral repository automation such as
  lint, Pages, static analysis, release metadata, or issue triage; that does
  not make those operating systems supported application targets.

## Shared repository completion memory

- Every task that changes this repository must end with all intended task work committed and pushed.
- Review every local and remote branch, linked worktree, and stash before cleanup. Preserve useful work in commits, integrate every completed branch or worktree into the default branch, and verify each source tip is an ancestor of the pushed remote default branch.
- Never delete a branch, worktree, stash, or checkout that contains uncommitted, unmerged, or unpushed work.
- After remote proof, remove merged temporary branches, linked worktrees, their on-disk directories, stale worktree metadata, and redundant stashes.
- The final handoff target is a clean default checkout, no staged, unstaged, untracked, or stashed task work, and zero divergence from the remote default branch. Preserve and report unrelated pre-existing work instead of discarding it.
- Record significant completion and cleanup decisions in a repository-tracked handoff or memory file and push that update.
- Never force-push unless the user explicitly requests a history rewrite and the consequences have been reviewed.
