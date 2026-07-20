import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it } from 'node:test'

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_merge-request-editor.scss'),
  'utf8'
)
const manifest = readFileSync(
  join(process.cwd(), 'app', 'styles', '_ui.scss'),
  'utf8'
)

describe('merge request editor responsive styles', () => {
  it('registers bounded editor and lifecycle surfaces', () => {
    assert.match(manifest, /@import 'ui\/merge-request-editor';/)
    assert.match(
      styles,
      /\.merge-request-editor \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: hidden;/
    )
    assert.match(
      styles,
      /\.merge-request-lifecycle \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: hidden;/
    )
    assert.doesNotMatch(styles, /overflow-x:\s*auto/)
  })

  it('uses minmax grids and compact single-column fallbacks', () => {
    assert.match(
      styles,
      /\.merge-request-editor-routing,[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/
    )
    assert.match(
      styles,
      /\.merge-request-lifecycle-summary \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/
    )
    assert.match(
      styles,
      /@container merge-request-editor \(max-width: 620px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/
    )
    assert.match(
      styles,
      /@container merge-request-lifecycle \(max-width: 420px\)[\s\S]*?width: 100%/
    )
    assert.match(
      styles,
      /@media \(max-width: 620px\)[\s\S]*?merge-request-lifecycle-summary[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/
    )
  })

  it('keeps focus, validation, and reduced-motion semantics visible', () => {
    assert.match(styles, /&:focus-visible[\s\S]*?box-shadow:/)
    assert.match(styles, /&\[aria-invalid='true'\][\s\S]*?border-color:/)
    assert.match(
      styles,
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none !important;[\s\S]*?transition: none !important;/
    )
  })
})
