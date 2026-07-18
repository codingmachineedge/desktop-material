import assert from 'node:assert'
import { readFile } from 'node:fs/promises'
import * as Path from 'node:path'
import { describe, it } from 'node:test'

const app = Path.resolve(__dirname, '../..')

describe('tab session, folder drop, and customization context contracts', () => {
  it('exposes explicit tab-session commands and responsive Material dialogs', async () => {
    const [menu, appSource, styles] = await Promise.all([
      readFile(
        Path.join(app, 'src/main-process/menu/build-default-menu.ts'),
        'utf8'
      ),
      readFile(Path.join(app, 'src/ui/app.tsx'), 'utf8'),
      readFile(
        Path.join(app, 'styles/ui/_repository-list-transfer.scss'),
        'utf8'
      ),
    ])
    assert.match(menu, /Export Current Tabs/)
    assert.match(menu, /Import Current Tabs/)
    assert.match(appSource, /ExportTabSessionDialog/)
    assert.match(appSource, /ImportTabSessionDialog/)
    assert.match(styles, /dialog#export-tab-session/)
    assert.match(styles, /dialog#import-tab-session/)
    assert.match(styles, /max-height: min\(220px, 34vh\)/)
  })

  it('shows a bounded folder-drop target and auto-adds repository folders', async () => {
    const [appSource, shell] = await Promise.all([
      readFile(Path.join(app, 'src/ui/app.tsx'), 'utf8'),
      readFile(Path.join(app, 'styles/_material-shell.scss'), 'utf8'),
    ])
    assert.match(appSource, /webUtils\.getPathForFile/)
    assert.match(appSource, /dispatcher\.addRepositories\(\[path\]\)/)
    assert.match(appSource, /Drop repository folders to open tabs/)
    assert.match(
      shell,
      /\.repository-drop-overlay\s*\{[\s\S]*?position: absolute/
    )
    assert.match(shell, /body\.repository-folder-dragging/)
  })

  it('provides profile/repository customization and local Git history context', async () => {
    const [appSource, tabStrip, brand] = await Promise.all([
      readFile(Path.join(app, 'src/ui/app.tsx'), 'utf8'),
      readFile(
        Path.join(app, 'src/ui/repository-tabs/repository-tab-strip.tsx'),
        'utf8'
      ),
      readFile(Path.join(app, 'src/ui/window/app-brand.tsx'), 'utf8'),
    ])
    assert.match(appSource, /onCustomizationContextMenu/)
    assert.match(appSource, /Local Git repository:/)
    assert.match(appSource, /Profile Git history:/)
    assert.match(appSource, /RepositorySettingsTab\.Appearance/)
    assert.match(tabStrip, /View Appearance and Tab History/)
    // The per-tab entry scopes the history popup to just that tab.
    assert.match(tabStrip, /scope: \{ kind: 'tab', tabId: tab\.id, label \}/)
    assert.match(tabStrip, /Profile Git history:/)
    assert.match(brand, /data-customization-surface="app-identity"/)
  })
})
