import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it } from 'node:test'

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_repository-tools.scss'),
  'utf8'
)

describe('guided bisect responsive styles', () => {
  it('contains every session surface and wraps commit metadata', () => {
    assert.match(styles, /\.repository-bisect-session[\s\S]*min-width: 0/)
    assert.match(
      styles,
      /\.repository-bisect-state[\s\S]*overflow-wrap: anywhere/
    )
    assert.match(
      styles,
      /\.repository-bisect-progress[\s\S]*word-break: break-word/
    )
    assert.match(
      styles,
      /\.repository-bisect-confirmation[\s\S]*overflow-x: hidden/
    )
  })

  it('uses bounded progress columns and stacks them at compact widths', () => {
    assert.match(
      styles,
      /\.repository-bisect-progress[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/
    )
    assert.match(
      styles,
      /@media \(max-width: 700px\)[\s\S]*\.repository-bisect-progress ol[\s\S]*grid-template-columns: minmax\(0, 1fr\)/
    )
    assert.match(
      styles,
      /@media \(max-width: 700px\)[\s\S]*\.repository-bisect-reset[\s\S]*width: 100%/
    )
  })
})
