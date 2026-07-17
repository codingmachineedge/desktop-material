import assert from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_notification-centre.scss'),
  'utf8'
)

describe('Notification centre v2 styles', () => {
  it('uses the v2 header inset of 20px top and 20px right', () => {
    assert.match(
      styles,
      /\.notification-centre-header\s*\{[\s\S]*?padding: 20px 20px 8px 20px;/
    )
  })

  it('keeps the header wrappable so the trailing controls always fit', () => {
    assert.match(
      styles,
      /\.notification-centre-header\s*\{[\s\S]*?flex-wrap: wrap;[\s\S]*?padding: 20px 20px 8px 20px;/
    )
  })

  it('gives the empty state its v2 inset of 40px by 20px', () => {
    assert.match(
      styles,
      /\.notification-centre-empty\s*\{[\s\S]*?padding: 40px 20px;/
    )
  })

  it('renders the empty-state glyph at 38px with softened opacity', () => {
    assert.match(
      styles,
      /\.notification-centre-empty\s*\{[\s\S]*?\.octicon\s*\{\s*width: 38px;\s*height: 38px;\s*opacity: 0\.6;\s*\}/
    )
  })

  it('styles the empty-state message as a 13.5px semibold heading', () => {
    assert.match(
      styles,
      /\.notification-centre-empty\s*\{[\s\S]*?span\s*\{\s*font-size: 13\.5px;\s*font-weight: var\(--font-weight-semibold\);\s*\}/
    )
  })
})
