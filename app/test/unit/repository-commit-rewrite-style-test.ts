import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const styles = readFileSync(
  join(process.cwd(), 'app/styles/ui/_repository-tools.scss'),
  'utf8'
)

describe('repository commit-rewrite responsive styles', () => {
  it('contains long commit titles and every review surface', () => {
    assert.match(styles, /\.repository-commit-rewrite \*/)
    assert.match(
      styles,
      /\.repository-commit-rewrite-plan > ol,[\s\S]*overflow-x: hidden;[\s\S]*overflow-y: auto;/
    )
    assert.match(
      styles,
      /\.repository-commit-rewrite-identity[\s\S]*grid-template-columns: auto minmax\(0, 1fr\);[\s\S]*overflow-wrap: anywhere;[\s\S]*word-break: break-word;/
    )
    assert.match(
      styles,
      /\.repository-commit-rewrite-confirmation,[\s\S]*overflow-x: hidden;[\s\S]*overflow-wrap: anywhere;/
    )
  })

  it('stacks plan actions and confirmation facts at compact widths', () => {
    assert.match(
      styles,
      /@media \(max-width: 700px\)[\s\S]*\.repository-commit-rewrite-row-controls,[\s\S]*grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      styles,
      /\.repository-commit-rewrite-row-controls[\s\S]*grid-template-columns: minmax\(190px, 1fr\) auto auto;/
    )
  })
})
