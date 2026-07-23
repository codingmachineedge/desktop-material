import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const styles = readFileSync(
  join(process.cwd(), 'app/styles/ui/_github-releases.scss'),
  'utf8'
)
const materialCards = readFileSync(
  join(process.cwd(), 'app/styles/ui/_material-cards.scss'),
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

  it('uses named inline-size containers for pane-aware compaction', () => {
    assert.match(
      styles,
      /\.github-releases-view \{[\s\S]*?container-name:\s*github-releases-pane;[\s\S]*?container-type:\s*inline-size;/
    )
    assert.match(
      styles,
      /\.github-releases-list-panel \{[\s\S]*?container-name:\s*github-releases-list;[\s\S]*?container-type:\s*inline-size;/
    )
    assert.match(
      styles,
      /@container github-releases-pane \(max-width: 760px\)[\s\S]*?\.github-releases-overview[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(112px, 1fr\)\);[\s\S]*?overflow-x:\s*visible;/
    )
    assert.match(
      styles,
      /@container github-releases-list \(max-width: 520px\)[\s\S]*?\.github-releases-filter-toolbar[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(96px, 112px\);/
    )
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

  it('keeps release rows visible with compact, accessible controls', () => {
    assert.match(
      styles,
      /grid-template-columns:\s*clamp\(420px, 34vw, 560px\) minmax\(0, 1fr\)/
    )
    assert.match(
      styles,
      /\.github-releases-bulk-selection input\[type='checkbox'\],[\s\S]*?width:\s*18px;[\s\S]*?height:\s*18px;[\s\S]*?min-height:\s*18px;/
    )
    assert.match(
      styles,
      /\.github-releases-bulk-actions \{[\s\S]*?\.button-component \{[\s\S]*?min-height:\s*32px;/
    )
    assert.match(
      styles,
      /@container github-releases-list \(max-width: 520px\)[\s\S]*?\.github-release-row \{[\s\S]*?min-height:\s*52px;/
    )
    assert.match(
      styles,
      /@media \(max-height: 760px\)[\s\S]*?\.github-releases-list \{[\s\S]*?min-height:\s*128px;/
    )
    assert.match(
      styles,
      /@media \(max-height: 760px\)[\s\S]*?\.github-releases-view \{[\s\S]*?overflow-y:\s*auto;/
    )
    assert.match(
      materialCards,
      /:not\(\.actions-view\):not\(\.github-releases-view\) \{\s*overflow: hidden;/
    )
    assert.match(
      styles,
      /\.github-releases-list \{[\s\S]*?overscroll-behavior:\s*contain;[\s\S]*?scrollbar-gutter:\s*stable;/
    )
  })

  it('reflows compact metrics instead of creating a horizontal strip', () => {
    assert.match(
      styles,
      /@container github-releases-pane \(max-width: 760px\)[\s\S]*?\.github-release-metric\.latest \{[\s\S]*?grid-column:\s*span 2;/
    )
    assert.match(
      styles,
      /@media \(max-height: 760px\)[\s\S]*?\.github-releases-overview \{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(108px, 1fr\)\);[\s\S]*?overflow-x:\s*visible;/
    )
    assert.doesNotMatch(
      styles,
      /@media \(max-height: 760px\)[\s\S]*?\.github-releases-overview \{[\s\S]*?overflow-x:\s*auto;/
    )
  })
})
