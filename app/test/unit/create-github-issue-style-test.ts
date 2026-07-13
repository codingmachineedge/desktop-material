import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it } from 'node:test'

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_create-github-issue.scss'),
  'utf8'
)

describe('Create GitHub issue responsive styles', () => {
  it('bounds the dialog to the viewport and forbids horizontal scrolling', () => {
    assert.match(
      styles,
      /#create-github-issue\s*\{[\s\S]*?max-width: calc\(100vw - var\(--spacing-double\)\);[\s\S]*?overflow-x: hidden;/
    )
    assert.match(
      styles,
      /#create-github-issue[\s\S]*?\*\s*\{[\s\S]*?min-width: 0;/
    )
    assert.doesNotMatch(styles, /overflow-x:\s*auto/)
  })

  it('wraps long provider, review, error, and button text', () => {
    assert.match(
      styles,
      /\.dialog-header h1,[\s\S]*?\.create-github-issue-browser-note\s*\{[\s\S]*?overflow-wrap: anywhere;[\s\S]*?word-break: break-word;/
    )
    assert.match(
      styles,
      /\.dialog-footer \.button-group\s*\{[\s\S]*?flex-wrap: wrap;[\s\S]*?white-space: normal;/
    )
    assert.match(
      styles,
      /\.create-github-issue-field[\s\S]*?input,[\s\S]*?textarea\s*\{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;/
    )
  })

  it('stacks full-width actions on narrow windows', () => {
    assert.match(styles, /@media \(max-width: 420px\)/)
    assert.match(
      styles,
      /@media \(max-width: 420px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?button\s*\{[\s\S]*?width: 100%;/
    )
  })
})
