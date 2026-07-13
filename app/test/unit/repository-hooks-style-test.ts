import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_repository-tools.scss'),
  'utf8'
)

describe('repository hooks manager styles', () => {
  it('contains long hook state and metadata without horizontal overflow', () => {
    assert.match(
      styles,
      /\.repository-hooks-manager[\s\S]*box-sizing: border-box;[\s\S]*min-width: 0;/
    )
    assert.match(
      styles,
      /\.repository-hooks-inventory > ul[\s\S]*overflow-x: hidden;[\s\S]*overflow-y: auto;/
    )
    assert.match(
      styles,
      /\.repository-hook-slot[\s\S]*overflow-wrap: anywhere;[\s\S]*word-break: break-word;/
    )
  })

  it('stacks hook states and confirmation metadata on narrow windows', () => {
    assert.match(
      styles,
      /@media \(max-width: 700px\)[\s\S]*\.repository-hook-row dl,[\s\S]*\.repository-hooks-confirmation dl > div[\s\S]*grid-template-columns: minmax\(0, 1fr\);/
    )
  })
})
