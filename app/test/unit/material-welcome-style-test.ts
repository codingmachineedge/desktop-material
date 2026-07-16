import assert from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('Material welcome design contract', () => {
  it('composes the first-run flow from a task card and tonal workspace panel', () => {
    const view = read('app/src/ui/welcome/welcome.tsx')
    const start = read('app/src/ui/welcome/start.tsx')

    assert.match(view, /className="welcome-step-card"/)
    assert.match(view, /className="welcome-product-lockup"/)
    assert.match(view, /className="welcome-workspace-preview"/)
    assert.match(view, /aria-label="Desktop Material workspace overview"/)
    assert.match(view, /Versioned settings/)
    assert.match(start, /className="welcome-material-icon"/)
    assert.match(start, /viewBox="0 0 24 24"/)
    assert.doesNotMatch(start, /Octicon|octicons\.generated/)
  })

  it('uses semantic Material tokens with compact and reduced-motion fallbacks', () => {
    const style = read('app/styles/ui/_welcome.scss')

    assert.match(
      style,
      /\.welcome-step-card\s*\{[\s\S]*?var\(--md-sys-color-surface-container-lowest\)/
    )
    assert.match(
      style,
      /\.welcome-right\s*\{[\s\S]*?var\(--md-sys-color-primary-container\)/
    )
    assert.match(style, /@media screen and \(max-width: 760px\)/)
    assert.match(style, /@media \(prefers-reduced-motion: reduce\)/)
    assert.match(
      style,
      /@media screen and \(max-width: 1040px\),[\s\S]*?\.welcome-workspace-preview\s*\{[\s\S]*?display: none;/
    )
  })
})
