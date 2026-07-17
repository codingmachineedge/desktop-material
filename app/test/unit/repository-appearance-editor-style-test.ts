import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (...parts: ReadonlyArray<string>) =>
  readFileSync(join(process.cwd(), ...parts), 'utf8')

/**
 * The per-repository appearance editor is a rich editor — colour swatches,
 * segmented controls, an inline typography editor, and a live preview — not a
 * stack of dropdowns. This pins the load-bearing pieces of that treatment.
 */
describe('repository appearance editor', () => {
  it('styles colour swatches, segmented chips, and the live preview', () => {
    const style = read('app', 'styles', 'ui', '_repository-logo.scss')

    // Round colour swatch driven by its own --swatch custom property, with a
    // primary ring on the active one.
    assert.match(
      style,
      /\.appearance-swatch \{[\s\S]*?background: var\(--swatch,/
    )
    assert.match(
      style,
      /\.appearance-swatch \{[\s\S]*?&\.active \{[\s\S]*?var\(--md-sys-color-primary\)/
    )
    // Segmented / toggle chip with a tonal active state.
    assert.match(
      style,
      /\.appearance-chip \{[\s\S]*?&\.active \{[\s\S]*?var\(--md-sys-color-secondary-container\)/
    )
    // Live preview canvas with a mock tab and repository-list row.
    assert.match(style, /\.repository-appearance-preview \{/)
    assert.match(style, /\.repository-appearance-preview-tab \{/)
    assert.match(style, /\.repository-appearance-preview-row \{/)
  })

  it('drives the controls from data attributes, not per-item closures', () => {
    const component = read(
      'app',
      'src',
      'ui',
      'repository-settings',
      'appearance.tsx'
    )
    // A single delegated click handler keyed by data-field / data-value.
    assert.match(component, /onClick=\{this\.onFieldClick\}/)
    assert.match(component, /data-field="accentPalette"/)
    assert.match(component, /accentOptions/)
    // The live preview and the typography editor are present.
    assert.match(component, /renderPreview\(\)/)
    assert.match(component, /renderStyleToggles\(\)/)
    assert.match(component, /renderTextColor\(\)/)
    // No leftover appearance dropdown <Select name=…> scaffolding.
    assert.doesNotMatch(component, /renderSelect\(/)
  })
})
