import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  getBranchNamePresetForShortcut,
  parseBranchNamePresets,
} from '../../src/models/branch-preset'

describe('branch name presets', () => {
  it('parses names, optional descriptions, whitespace, and CRLF', () => {
    assert.deepEqual(
      parseBranchNamePresets(
        'feature/ New features\r\n  bugfix/   Bug fixes  \r\n\r\nhotfix/\n'
      ),
      [
        { name: 'feature/', description: 'New features' },
        { name: 'bugfix/', description: 'Bug fixes' },
        { name: 'hotfix/', description: 'hotfix/' },
      ]
    )
  })

  it('maps only Ctrl/Cmd shortcut number keys 1 through 9', () => {
    const presets = parseBranchNamePresets('one/ First\ntwo/ Second')
    assert.equal(getBranchNamePresetForShortcut('1', presets)?.name, 'one/')
    assert.equal(getBranchNamePresetForShortcut('2', presets)?.name, 'two/')
    assert.equal(getBranchNamePresetForShortcut('0', presets), undefined)
    assert.equal(getBranchNamePresetForShortcut('x', presets), undefined)
  })
})
