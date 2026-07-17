import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'

const read = (path: string) =>
  readFileSync(resolve(__dirname, '../../..', path), 'utf8')

describe('filtered-list context menu routing', () => {
  it('routes keyboard context-menu activation through plain filtered lists', () => {
    const source = read('app/src/ui/lib/filter-list.tsx')
    assert.match(
      source,
      /onRowKeyboardContextMenu=\{this\.onRowKeyboardContextMenu\}/
    )
    assert.match(
      source,
      /private onRowKeyboardContextMenu[\s\S]*?this\.onRowContextMenu\(/
    )
  })

  it('routes keyboard context-menu activation through sectioned lists', () => {
    const filter = read('app/src/ui/lib/section-filter-list.tsx')
    const list = read('app/src/ui/lib/list/section-list.tsx')

    assert.match(
      filter,
      /onRowKeyboardContextMenu=\{this\.onRowKeyboardContextMenu\}/
    )
    assert.match(
      filter,
      /private onRowKeyboardContextMenu[\s\S]*?this\.onRowContextMenu\(/
    )
    assert.match(
      list,
      /onKeyboardContextMenu=\{this\.onRowKeyboardContextMenu\}/
    )
  })

  it('keeps every existing filtered-list menu owner on the shared path', () => {
    for (const path of [
      'app/src/ui/branches/branch-list.tsx',
      'app/src/ui/branches/pull-request-list.tsx',
      'app/src/ui/changes/filter-changes-list.tsx',
      'app/src/ui/repositories-list/repositories-list.tsx',
      'app/src/ui/worktrees/worktree-list.tsx',
    ]) {
      assert.match(
        read(path),
        /onItemContextMenu=\{this\.[A-Za-z]+ContextMenu\}/
      )
    }
  })
})
