import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_github-issues.scss'),
  'utf8'
)

describe('GitHub Issues responsive Material styles', () => {
  it('contains every issue surface and prevents horizontal overflow', () => {
    assert.match(
      styles,
      /\.github-issues-view,[\s\S]*?\.github-issues-view \*[\s\S]*?min-width: 0;/
    )
    assert.match(styles, /\.github-issues-view \{[\s\S]*?overflow: hidden;/)
    assert.match(
      styles,
      /\.github-issue-composer,[\s\S]*?\.github-issue-confirmation,[\s\S]*?\.github-issue-comments[\s\S]*?overflow-x: hidden;/
    )
  })

  it('collapses filters, layout, metadata, and controls on narrow screens', () => {
    assert.match(styles, /@media \(max-width: 1100px\)/)
    assert.match(
      styles,
      /@media \(max-width: 720px\)[\s\S]*?\.github-issues-filters,[\s\S]*?\.github-issue-metadata,[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      styles,
      /\.github-issues-controls \.button-component[\s\S]*?width: 100%;/
    )
  })

  it('keeps issue and comment text wrapping without rendering rich provider HTML', () => {
    assert.match(styles, /\.github-issue-body[\s\S]*?white-space: pre-wrap;/)
    assert.match(
      styles,
      /\.github-issue-comment-list[\s\S]*?white-space: pre-wrap;/
    )
  })
})
