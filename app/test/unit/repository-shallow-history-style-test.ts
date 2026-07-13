import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const styles = readFileSync(
  join(process.cwd(), 'app/styles/ui/_repository-tools.scss'),
  'utf8'
)

describe('repository shallow-history responsive styles', () => {
  it('contains every guided history surface within its card', () => {
    assert.match(styles, /\.repository-shallow-history \*/)
    assert.match(
      styles,
      /\.repository-shallow-history-state[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*overflow-x: hidden;/
    )
    assert.match(
      styles,
      /\.repository-shallow-history-form[\s\S]*grid-template-columns: minmax\(0, 1fr\)/
    )
    assert.match(
      styles,
      /input,[\s\S]*select[\s\S]*max-width: 100%;[\s\S]*min-width: 0;[\s\S]*width: 100%/
    )
  })

  it('wraps finite text and stacks structured review rows when narrow', () => {
    assert.match(
      styles,
      /\.repository-shallow-history-confirmation[\s\S]*overflow-x: hidden;[\s\S]*overflow-wrap: anywhere;[\s\S]*word-break: break-word;/
    )
    assert.match(
      styles,
      /\.repository-shallow-history-output[\s\S]*overflow-wrap: anywhere;[\s\S]*overflow-x: hidden;[\s\S]*white-space: pre-wrap;[\s\S]*word-break: break-word;/
    )
    assert.match(
      styles,
      /@media \(max-width: 700px\)[\s\S]*\.repository-shallow-history-confirmation dl > div[\s\S]*grid-template-columns: minmax\(0, 1fr\)/
    )
  })
})
