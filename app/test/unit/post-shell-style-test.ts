import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const readStyle = (name: string) =>
  readFileSync(join(process.cwd(), 'app', 'styles', 'ui', name), 'utf8')

describe('post-shell MD3 style contracts', () => {
  it('uses system tokens instead of literal colors in the Actions log viewer', () => {
    const style = readStyle('_actions-log-viewer.scss')
    assert.doesNotMatch(style, /#[\da-f]{3,8}\b|rgba?\(/i)
    assert.match(style, /--md-sys-color-inverse-surface/)
  })

  it('keeps Actions and Agent Access responsive on narrow windows', () => {
    assert.match(readStyle('_actions-view.scss'), /max-width: 620px/)
    assert.match(readStyle('_agent-access.scss'), /max-width: 430px/)
  })

  it('makes Pull all results horizontally scrollable on narrow windows', () => {
    const style = readStyle('_pull-all.scss')
    assert.match(style, /pull-all-results-container/)
    assert.match(style, /overflow: auto/)
  })
})
