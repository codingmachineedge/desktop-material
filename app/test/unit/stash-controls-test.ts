import { describe, it } from 'node:test'
import assert from 'node:assert'
import { isStashContextMenuKey } from '../../src/ui/changes/filter-changes-list'

describe('multiple stash controls', () => {
  it('opens stash actions from the keyboard context-menu shortcuts', () => {
    assert.equal(isStashContextMenuKey('ContextMenu', false), true)
    assert.equal(isStashContextMenuKey('F10', true), true)
    assert.equal(isStashContextMenuKey('F10', false), false)
    assert.equal(isStashContextMenuKey('Enter', false), false)
  })
})
