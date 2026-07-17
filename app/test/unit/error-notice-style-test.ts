import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { resolve } from 'node:path'

const styles = readFileSync(
  resolve(__dirname, '../../styles/ui/_error-notice-stack.scss'),
  'utf8'
)

describe('error notice responsive styles', () => {
  it('anchors a bounded red Material stack at the bottom right', () => {
    assert.match(styles, /\.error-notice-stack\s*\{[\s\S]*?position:\s*fixed/)
    assert.match(styles, /right:\s*max\(16px, env\(safe-area-inset-right\)\)/)
    assert.match(styles, /bottom:\s*max\(16px, env\(safe-area-inset-bottom\)\)/)
    assert.match(styles, /width:\s*min\(420px, calc\(100vw - 32px\)\)/)
    assert.match(styles, /max-height:\s*min\(70vh, 560px\)/)
    assert.match(styles, /background:\s*var\(--md-sys-color-error\)/)
    assert.match(styles, /color:\s*var\(--md-sys-color-on-error\)/)
  })

  it('wraps untrusted copy and stays reachable on narrow or short viewports', () => {
    assert.match(styles, /overflow-wrap:\s*anywhere/)
    assert.match(styles, /overflow-x:\s*hidden/)
    assert.match(styles, /overflow-y:\s*auto/)
    assert.match(styles, /@media \(max-width: 480px\)/)
    assert.match(styles, /grid-template-columns:\s*auto minmax\(0, 1fr\)/)
    assert.match(styles, /@media \(max-height: 480px\)/)
    assert.match(styles, /max-height:\s*calc\(100vh - 16px\)/)
    assert.match(styles, /:focus-visible/)
  })
})
