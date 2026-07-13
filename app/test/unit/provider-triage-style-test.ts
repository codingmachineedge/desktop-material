import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const styles = readFileSync(
  join(process.cwd(), 'app/styles/ui/_repository-tools.scss'),
  'utf8'
)

describe('provider triage responsive Material styles', () => {
  it('contains containment, wrapping, focus, and narrow layouts', () => {
    assert.match(styles, /\.provider-triage\s*\{[\s\S]*?min-width:\s*0/)
    assert.match(styles, /overflow-wrap:\s*anywhere/)
    assert.match(
      styles,
      /\.provider-triage-filters[\s\S]*?minmax\(min\(100%, 170px\)/
    )
    assert.match(styles, /:focus-visible/)
    assert.match(styles, /@media \(max-width: 700px\)/)
    assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\)/)
  })

  it('uses semantic Material tokens for states and attention', () => {
    assert.match(styles, /--md-sys-color-surface-container-high/)
    assert.match(styles, /--md-sys-color-primary-container/)
    assert.match(styles, /--md-sys-color-tertiary-container/)
    assert.match(styles, /--md-sys-color-error-container/)
    assert.match(styles, /\.provider-triage-channel/)
    assert.match(styles, /\.provider-triage-attention/)
  })
})
