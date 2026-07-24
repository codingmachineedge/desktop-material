import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_github-api-explorer.scss'),
  'utf8'
)
const imports = readFileSync(
  join(process.cwd(), 'app', 'styles', '_ui.scss'),
  'utf8'
)
const cards = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_material-cards.scss'),
  'utf8'
)

describe('GitHub API Explorer responsive Material styles', () => {
  it('registers explicit containment, wrapping, focus, and narrow layouts', () => {
    assert.match(imports, /@import 'ui\/github-api-explorer'/)
    assert.match(styles, /min-width:\s*0/)
    assert.match(styles, /max-width:\s*100%/)
    assert.match(styles, /overflow-x:\s*hidden/)
    assert.match(styles, /overflow-wrap:\s*anywhere/)
    assert.match(styles, /white-space:\s*pre-wrap/)
    assert.match(styles, /:focus-visible/)
    assert.match(styles, /@media \(max-width: 900px\)/)
    assert.match(styles, /@media \(max-width: 600px\)/)
    assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\)/)
  })

  it('keeps the compact Explorer and app functions independently bounded', () => {
    assert.match(
      styles,
      /@media \(max-width: 900px\)[\s\S]*#repository > \.github-api-explorer\s*\{[^}]*overflow-y:\s*auto[^}]*\}/
    )
    assert.match(
      styles,
      /\.github-api-functions\s*\{[\s\S]*width:\s*100%[\s\S]*max-width:\s*100%[\s\S]*min-width:\s*0[\s\S]*overflow-x:\s*hidden/
    )
    assert.match(
      styles,
      /\.github-api-function-editor\s*\{[\s\S]*width:\s*100%[\s\S]*max-width:\s*100%[\s\S]*min-width:\s*0/
    )
    assert.match(
      cards,
      /:not\(\.tutorial-panel-component[\s\S]*?:not\(\.github-api-explorer\):not\(\.actions-view\):not\(\.github-releases-view\):not\(\.cheap-lfs-manager-view\)\s*\{[\s\S]*?overflow: hidden;/
    )
  })

  it('delegates catalog pagination styling to the shared partial', () => {
    assert.match(imports, /@import 'ui\/catalog-pagination'/)
    // The Explorer must not redefine its own pagination controls.
    assert.doesNotMatch(styles, /github-api-explorer-pagination/)
  })

  it('uses semantic Material tokens for surfaces, selection, and risk', () => {
    assert.match(styles, /--md-sys-color-surface-container-low/)
    assert.match(styles, /--md-sys-color-primary-container/)
    assert.match(styles, /--md-sys-color-tertiary-container/)
    assert.match(styles, /--md-sys-color-error-container/)
    assert.match(styles, /\.destructive/)
  })
})
