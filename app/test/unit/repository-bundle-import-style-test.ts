import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const styles = readFileSync(
  join(process.cwd(), 'app/styles/ui/_repository-tools.scss'),
  'utf8'
)

describe('repository bundle import responsive styles', () => {
  it('bounds every form and confirmation surface to its container', () => {
    assert.match(styles, /\.repository-bundle-import \*/)
    assert.match(
      styles,
      /\.repository-bundle-import-form[\s\S]*grid-template-columns: minmax\(0, 1fr\)/
    )
    assert.match(
      styles,
      /input,[\s\S]*select[\s\S]*max-width: 100%;[\s\S]*min-width: 0;[\s\S]*width: 100%/
    )
    assert.match(
      styles,
      /\.repository-bundle-import-confirmation[\s\S]*overflow-x: hidden/
    )
  })

  it('wraps long paths, refs, object IDs, and command results without sideways scrolling', () => {
    assert.match(
      styles,
      /\.repository-bundle-path,[\s\S]*overflow-wrap: anywhere;[\s\S]*word-break: break-word/
    )
    assert.match(
      styles,
      /\.repository-bundle-import-output[\s\S]*overflow-wrap: anywhere;[\s\S]*overflow-x: hidden;[\s\S]*white-space: pre-wrap;[\s\S]*word-break: break-word/
    )
    assert.match(
      styles,
      /@media \(max-width: 700px\)[\s\S]*\.repository-bundle-import-confirmation dl > div[\s\S]*grid-template-columns: minmax\(0, 1fr\)/
    )
  })
})
