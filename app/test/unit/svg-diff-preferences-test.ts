import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert'
import {
  getSvgDiffShowCode,
  saveSvgDiffShowCode,
} from '../../src/ui/diff/image-diffs/svg-diff-preferences'

describe('SVG diff preferences', () => {
  beforeEach(() => localStorage.removeItem('svg-diff-show-code'))

  it('defaults to the safer code view', () => {
    assert.equal(getSvgDiffShowCode(), true)
  })

  it('persists the selected preview mode', () => {
    saveSvgDiffShowCode(false)
    assert.equal(getSvgDiffShowCode(), false)
  })
})
