# Worktree in active use — do not delete yet

An ultracode audit session (Claude, started 2026-07-20) is actively working in
this worktree (`claude/material-design-ui-audit-763c44`).

Currently in flight:
- Multiple background feature waves editing this tree (chat expansion, send-to-
  OpenCode, clone-org visibility v2, run-workflow picker list box) plus already-
  completed-but-uncommitted work (Ollama chat, command palette, Build & Run
  panel, repo-list Customize + force-delete).
- Pending after those land: combined-tree reconciliation (tsc + tests), grouped
  per-feature commits, merge to `main`, and push.

Do not remove this worktree, its branch, or its uncommitted state until this
marker file is deleted by the session that created it. This file is tracked only
transiently and will be `git rm`-ed before the merge so it never reaches `main`.
