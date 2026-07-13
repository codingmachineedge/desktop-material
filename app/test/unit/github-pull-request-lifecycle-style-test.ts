import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it } from 'node:test'

const styles = readFileSync(
  join(
    process.cwd(),
    'app',
    'styles',
    'ui',
    '_github-pull-request-lifecycle.scss'
  ),
  'utf8'
)

describe('GitHub pull request lifecycle responsive styles', () => {
  it('bounds the workbench and scrolls inside the dialog', () => {
    assert.match(styles, /width: min\(760px, calc\(100vw/)
    assert.match(styles, /max-height: calc\(100vh/)
    assert.match(styles, /overflow-x: hidden/)
    assert.match(styles, /\.dialog-content[\s\S]*?overflow-y: auto/)
  })

  it('uses minmax columns and collapses to one column', () => {
    assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
    assert.match(
      styles,
      /@media \(max-width: 680px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/
    )
  })

  it('wraps compact actions into full-width rows', () => {
    assert.match(
      styles,
      /@media \(max-width: 440px\)[\s\S]*?\.dialog-footer \.button-group[\s\S]*?grid-template-columns: minmax\(0, 1fr\)[\s\S]*?width: 100%/
    )
  })
})
