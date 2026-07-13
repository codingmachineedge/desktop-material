import assert from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_repository-tools.scss'),
  'utf8'
)

describe('Repository signing and Git LFS responsive styles', () => {
  it('contains every administration surface and wraps untrusted identifiers', () => {
    assert.match(styles, /\.repository-signing[\s\S]*min-width: 0/)
    assert.match(styles, /\.repository-lfs-administration[\s\S]*min-width: 0/)
    assert.match(
      styles,
      /\.repository-admin-state[\s\S]*overflow-wrap: anywhere/
    )
    assert.match(
      styles,
      /\.repository-admin-confirmation[\s\S]*overflow-x: hidden/
    )
    assert.match(
      styles,
      /\.repository-lfs-patterns[\s\S]*word-break: break-word/
    )
  })

  it('uses bounded minmax grids and stacks forms at compact widths', () => {
    assert.match(
      styles,
      /\.repository-admin-form[\s\S]*grid-template-columns: minmax\(0, 1fr\)/
    )
    assert.match(
      styles,
      /\.repository-lfs-patterns li[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto auto/
    )
    assert.match(
      styles,
      /@media \(max-width: 700px\)[\s\S]*\.repository-admin-confirmation dl > div[\s\S]*grid-template-columns: minmax\(0, 1fr\)/
    )
    assert.match(
      styles,
      /@media \(max-width: 700px\)[\s\S]*\.repository-lfs-patterns \.button-component[\s\S]*width: 100%/
    )
  })
})
