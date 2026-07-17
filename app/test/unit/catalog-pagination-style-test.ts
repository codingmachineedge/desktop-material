import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_catalog-pagination.scss'),
  'utf8'
)
const imports = readFileSync(
  join(process.cwd(), 'app', 'styles', '_ui.scss'),
  'utf8'
)

describe('shared catalog pagination styles', () => {
  it('is registered in the UI stylesheet bundle', () => {
    assert.match(imports, /@import 'ui\/catalog-pagination'/)
  })

  it('wraps controls and keeps them bounded', () => {
    assert.match(styles, /\.catalog-pagination\s*\{[\s\S]*flex-wrap:\s*wrap/)
    assert.match(styles, /min-width:\s*0/)
    assert.match(
      styles,
      /\.catalog-pagination-controls\s*\{[\s\S]*flex-wrap:\s*wrap/
    )
  })

  it('gives disabled navigation a not-allowed affordance', () => {
    assert.match(
      styles,
      /\.catalog-pagination-controls\s*\{[\s\S]*button\s*\{[\s\S]*&:disabled\s*\{[\s\S]*cursor:\s*not-allowed/
    )
  })

  it('renders the page-size selector inline with a Material focus ring', () => {
    assert.match(
      styles,
      /\.catalog-pagination-page-size\s*\{[\s\S]*select\s*\{[\s\S]*width:\s*auto/
    )
    assert.match(styles, /:focus-visible/)
  })

  it('styles the direct "Go to page" selector', () => {
    assert.match(
      styles,
      /\.catalog-pagination-jump\s*\{[\s\S]*select\s*\{[\s\S]*width:\s*auto/
    )
  })

  it('uses semantic Material tokens', () => {
    assert.match(styles, /--md-sys-color-outline-variant/)
    assert.match(styles, /--md-sys-color-surface-container/)
    assert.match(styles, /--md-sys-color-primary/)
  })
})
