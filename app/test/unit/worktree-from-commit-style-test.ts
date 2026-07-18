import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const read = (...segments: ReadonlyArray<string>) =>
  readFileSync(join(process.cwd(), 'app', ...segments), 'utf8')

describe('worktree-from-commit contracts', () => {
  it('offers the action on every History commit right-click', () => {
    const commitList = read('src', 'ui', 'history', 'commit-list.tsx')

    assert.match(
      commitList,
      /'Create Worktree from Commit…'\s*:\s*'Create worktree from commit…'/
    )
    assert.match(commitList, /onCreateWorktreeFromCommit\?\.\(commit\)/)
    assert.match(
      commitList,
      /enabled: this\.props\.onCreateWorktreeFromCommit !== undefined/
    )
  })

  it('routes the commit into the Add Worktree dialog anchored at its SHA', () => {
    const compare = read('src', 'ui', 'history', 'compare.tsx')
    assert.match(
      compare,
      /onCreateWorktreeFromCommit = \(commit: CommitOneLine\) => \{[\s\S]*?type: PopupType\.AddWorktree,[\s\S]*?commitish: commit\.sha,[\s\S]*?initialWorktreeName: `commit-\$\{commit\.sha\.slice\(0, 8\)\}`/
    )

    const popup = read('src', 'models', 'popup.ts')
    assert.match(
      popup,
      /type: PopupType\.AddWorktree[\s\S]*?commitish\?: string/
    )

    const app = read('src', 'ui', 'app.tsx')
    assert.match(app, /commitish=\{popup\.commitish\}/)
  })

  it('creates a fresh branch at the commit and refuses name collisions', () => {
    const dialog = read('src', 'ui', 'worktrees', 'add-worktree-dialog.tsx')

    // Commit-anchored creation always makes a new branch at the commit.
    assert.match(
      dialog,
      /if \(this\.props\.commitish !== undefined\) \{[\s\S]*?createBranch: effectiveBranchName,[\s\S]*?commitish: this\.props\.commitish,/
    )
    // The primary action is blocked while the name matches an existing branch.
    assert.match(
      dialog,
      /commitAnchoredNameCollision =[\s\S]*?this\.props\.commitish !== undefined &&[\s\S]*?allBranches\.some\(b => b\.name === effectiveBranchName\)/
    )
    assert.match(dialog, /commitAnchoredNameCollision\s*$/m)
    // The hint explains both outcomes.
    assert.match(dialog, /Will create branch/)
    assert.match(dialog, /already exists — choose a new/)
  })
})
