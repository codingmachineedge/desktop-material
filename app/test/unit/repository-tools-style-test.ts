import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_repository-tools.scss'),
  'utf8'
)

describe('Repository tools responsive styles', () => {
  it('wraps long labels and result output without horizontal clipping', () => {
    assert.match(styles, /\.repository-tools[\s\S]*overflow-x: hidden/)
    assert.match(styles, /\.repository-tool-card[\s\S]*overflow-wrap: anywhere/)
    assert.match(
      styles,
      /\.repository-tools-output[\s\S]*white-space: pre-wrap/
    )
    assert.match(styles, /\.repository-tools-output[\s\S]*overflow-x: hidden/)
  })

  it('stacks results and controls at compact and zoomed widths', () => {
    assert.match(styles, /@media \(max-width: 1120px\)/)
    assert.match(
      styles,
      /@media \(max-width: 1120px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/
    )
    assert.match(styles, /@media \(max-width: 700px\)/)
    assert.match(styles, /flex-direction: column/)
    assert.match(
      styles,
      /\.repository-tool-card\s*\{[\s\S]*?\.button-component\s*\{[\s\S]*?max-width: 100%/
    )
    assert.match(
      styles,
      /\.repository-tool-confirmation[\s\S]*overflow-wrap: anywhere/
    )
  })
})
