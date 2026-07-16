import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFile } from 'fs/promises'
import * as Path from 'path'

const app = Path.resolve(__dirname, '../..')
const styles = Path.join(app, 'styles')

describe('appearance customization style contracts', () => {
  it('defines curated light and dark accent role bundles', async () => {
    const material = await readFile(Path.join(styles, '_material.scss'), 'utf8')

    for (const accent of ['violet', 'teal', 'green', 'amber', 'rose']) {
      assert.match(material, new RegExp(`data-dm-accent='${accent}'`))
      assert.match(
        material,
        new RegExp(`theme-dark\\[data-dm-accent='${accent}'`)
      )
    }
    assert.match(material, /--md-sys-color-on-primary:/)
    assert.match(material, /data-dm-surface='neutral'/)
  })

  it('covers motion, toolbar, list, and tab attributes', async () => {
    const [shell, list, tabs] = await Promise.all([
      readFile(Path.join(styles, '_material-shell.scss'), 'utf8'),
      readFile(Path.join(styles, 'ui/_repository-list.scss'), 'utf8'),
      readFile(Path.join(styles, 'ui/_repository-tabs.scss'), 'utf8'),
    ])

    assert.match(shell, /data-dm-motion='reduced'/)
    assert.match(shell, /data-dm-toolbar-density='compact'/)
    assert.match(shell, /data-dm-toolbar-labels='icons'/)
    assert.match(list, /data-dm-repository-list-density='compact'/)
    assert.match(tabs, /data-dm-tab-density='compact'/)
    assert.match(tabs, /data-dm-tab-width='wide'/)
    assert.match(tabs, /data-dm-tab-close-buttons='always'/)
  })

  it('explains app and repository appearance scope in a Material tonal note', async () => {
    const [appearance, preferences] = await Promise.all([
      readFile(Path.join(app, 'src/ui/preferences/appearance.tsx'), 'utf8'),
      readFile(Path.join(styles, 'ui/_preferences.scss'), 'utf8'),
    ])

    assert.match(appearance, /className="appearance-scope-note"/)
    assert.match(appearance, /role="note"/)
    assert.match(appearance, /active profile&apos;s local Git/)
    assert.match(appearance, /Repository Settings/)

    assert.match(
      preferences,
      /\.appearance-scope-note\s*\{[\s\S]*?var\(--md-sys-color-secondary-container\)/
    )
    assert.match(
      preferences,
      /\.appearance-scope-note-icon\s*\{[\s\S]*?var\(--md-sys-color-primary-container\)/
    )
  })
})
