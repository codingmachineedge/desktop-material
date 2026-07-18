import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const styles = readFileSync(
  join(process.cwd(), 'app/styles/ui/_github-releases.scss'),
  'utf8'
)

describe('GitHub Releases responsive Material styles', () => {
  it('contains explicit containment, wrapping, focus, and narrow layouts', () => {
    assert.match(styles, /min-width:\s*0/)
    assert.match(styles, /overflow-wrap:\s*anywhere/)
    assert.match(styles, /word-break:\s*break-all/)
    assert.match(styles, /:focus-visible/)
    assert.match(styles, /@media \(max-width: 760px\)/)
    assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\)/)
  })

  it('uses semantic Material tokens for surfaces and destructive states', () => {
    assert.match(styles, /--md-sys-color-surface-container-low/)
    assert.match(styles, /--md-sys-color-primary-container/)
    assert.match(styles, /--md-sys-color-error-container/)
    assert.match(styles, /\.destructive/)
  })

  it('styles the dashboard, filters, metadata, and resilient loading states', () => {
    assert.match(styles, /\.github-releases-overview/)
    assert.match(styles, /\.github-release-metric\.latest/)
    assert.match(styles, /\.github-releases-filter-toolbar/)
    assert.match(styles, /\.github-release-metadata/)
    assert.match(styles, /\.github-releases-loading-indicator/)
    assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/)
  })
})
