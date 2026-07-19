import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const style = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_repository-list.scss'),
  'utf8'
)
const app = readFileSync(
  join(process.cwd(), 'app', 'src', 'ui', 'app.tsx'),
  'utf8'
)

describe('repository list scope filter styles', () => {
  it('bounds both selectors and stacks them at compact sizes', () => {
    assert.match(
      style,
      /\.repository-list-scope-filters\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?min-width: 0;/
    )
    assert.match(
      style,
      /\.repository-list-scope-filters[\s\S]*?select\s*\{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;/
    )
    assert.match(
      style,
      /@media \(max-width: 520px\), \(max-height: 560px\)[\s\S]*?\.repository-list \.repository-list-scope-filters\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    )
  })

  it('receives live accounts from the app shell', () => {
    assert.match(
      app,
      /<RepositoriesList[\s\S]*?accounts=\{this\.state\.accounts\}/
    )
  })

  it('wraps accessible status chips and identifies recovered hidden rows', () => {
    assert.match(
      style,
      /\.repository-list-status-chips\s*\{[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap;/
    )
    assert.match(
      style,
      /\.repository-status-chip,[\s\S]*?\.repository-hidden-toggle\s*\{[\s\S]*?min-height: 30px;[\s\S]*?&:focus-visible\s*\{[\s\S]*?outline: 2px solid var\(--md-sys-color-primary\);[\s\S]*?&\[aria-pressed='true'\]/
    )
    assert.match(
      style,
      /\.repository-hidden-pill\s*\{[\s\S]*?border-radius: 999px;[\s\S]*?flex: 0 0 auto;/
    )
  })
})
