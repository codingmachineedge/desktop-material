import { readFile } from 'fs/promises'
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { join } from 'path'

describe('worktree administration responsive styles', () => {
  it('bounds maintenance review content inside the worktree foldout', async () => {
    const styles = await readFile(
      join(process.cwd(), 'app/styles/ui/_worktrees.scss'),
      'utf8'
    )
    assert.match(
      styles,
      /\.worktree-list-post-filter\s*\{[^}]*overflow-x:\s*hidden/s
    )
    assert.match(
      styles,
      /\.worktree-list-post-filter\s*\{[^}]*overflow-y:\s*auto/s
    )
    assert.match(
      styles,
      /\.worktree-maintenance-controls\s*\{[^}]*flex-wrap:\s*wrap/s
    )
    assert.match(styles, /overflow-wrap:\s*anywhere/)
  })
})
