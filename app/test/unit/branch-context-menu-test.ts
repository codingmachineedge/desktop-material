import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Branch, BranchType } from '../../src/models/branch'
import { generateBranchContextMenuItems } from '../../src/ui/branches/branch-list-item-context-menu'

const branch = new Branch(
  'feature/visibility',
  null,
  { sha: '1234567' },
  BranchType.Local,
  ''
)

describe('branch visibility context menu', () => {
  it('exposes pin, hide, solo, and restore as named operations', () => {
    const calls = new Array<string>()
    const items = generateBranchContextMenuItems({
      branch,
      isPinned: false,
      isSolo: false,
      canHide: true,
      hasVisibilityOverrides: true,
      onTogglePin: () => calls.push('pin'),
      onHide: () => calls.push('hide'),
      onSolo: () => calls.push('solo'),
      onRestoreVisibility: () => calls.push('restore'),
    })

    for (const label of [
      'Pin branch',
      'Hide branch',
      'Solo branch',
      'Restore all branches',
    ]) {
      const item = items.find(candidate => candidate.label === label)
      assert.notEqual(item, undefined)
      item?.action?.()
    }

    assert.deepEqual(calls, ['pin', 'hide', 'solo', 'restore'])
  })

  it('disables hiding the current/default branch and labels active toggles', () => {
    const items = generateBranchContextMenuItems({
      branch,
      isPinned: true,
      isSolo: true,
      canHide: false,
      hasVisibilityOverrides: false,
      onTogglePin: () => undefined,
      onHide: () => undefined,
      onSolo: () => undefined,
      onRestoreVisibility: () => undefined,
    })

    assert.notEqual(
      items.find(item => item.label === 'Unpin branch'),
      undefined
    )
    assert.notEqual(
      items.find(item => item.label === 'Exit solo view'),
      undefined
    )
    assert.equal(
      items.find(item => item.label === 'Hide branch')?.enabled,
      false
    )
    assert.equal(
      items.find(item => item.label === 'Restore all branches')?.enabled,
      false
    )
  })
})
