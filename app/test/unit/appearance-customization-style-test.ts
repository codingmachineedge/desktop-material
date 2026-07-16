import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFile } from 'fs/promises'
import * as Path from 'path'

const styles = Path.resolve(__dirname, '../../styles')

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
})
