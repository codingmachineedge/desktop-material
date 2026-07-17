import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('guided shallow clone UI contracts', () => {
  it('exposes task-specific depth controls and explicit clone options', () => {
    const ui = read('app/src/ui/clone-repository/clone-repository.tsx')
    const git = read('app/src/lib/git/clone.ts')

    assert.match(ui, />\s*Shallow clone/)
    assert.match(ui, /type="number"/)
    assert.match(ui, /normalizeCloneDepth\(/)
    assert.match(ui, /singleBranch: depth !== undefined/)
    assert.match(git, /getShallowCloneArgs\(options\)/)
    assert.doesNotMatch(ui, /command arguments|role="searchbox"/i)
  })

  it('stacks compact controls and wraps clone tabs without sideways scrolling', () => {
    const style = read('app/styles/ui/_add-repository.scss')

    assert.match(style, /\.clone-history-options[\s\S]*min-width: 0/)
    assert.match(
      style,
      /@media \(max-width: 640px\)[\s\S]*\.tab-bar[\s\S]*flex-wrap: wrap[\s\S]*overflow-x: hidden/
    )
    assert.match(
      style,
      /@media \(max-width: 640px\)[\s\S]*\.clone-history-options[\s\S]*grid-template-columns: minmax\(0, 1fr\)/
    )
  })

  it('exposes select-all and opt-in automatic new-repository cloning', () => {
    const list = read(
      'app/src/ui/clone-repository/cloneable-repository-filter-list.tsx'
    )
    const ui = read('app/src/ui/clone-repository/clone-repository.tsx')
    const autoCloneStore = read('app/src/lib/stores/auto-clone-store.ts')
    const style = read('app/styles/ui/_batch-clone.scss')

    assert.match(list, /label="Select all"/)
    assert.match(list, /CheckboxValue\.Mixed/)
    assert.match(ui, /autoCloneNewRepositories/)
    assert.match(ui, /dispatcher\.configureAutoClone\(/)
    assert.doesNotMatch(ui, /window\.setInterval/)
    assert.match(autoCloneStore, /class AutoCloneStore/)
    assert.match(autoCloneStore, /window\.setInterval/)
    assert.match(autoCloneStore, /baselineEstablished/)
    assert.match(autoCloneStore, /startBackgroundBatch/)
    assert.match(style, /\.auto-clone-toggle[\s\S]*overflow-wrap: anywhere/)
  })
})
