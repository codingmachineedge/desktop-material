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

  it('anchors independently versioned appearance editors to their owners', async () => {
    const [appSource, tabStrip, tab, brand] = await Promise.all([
      readFile(Path.join(app, 'src/ui/app.tsx'), 'utf8'),
      readFile(
        Path.join(app, 'src/ui/repository-tabs/repository-tab-strip.tsx'),
        'utf8'
      ),
      readFile(
        Path.join(app, 'src/ui/repository-tabs/repository-tab.tsx'),
        'utf8'
      ),
      readFile(Path.join(app, 'src/ui/window/app-brand.tsx'), 'utf8'),
    ])
    assert.match(appSource, /onCustomizationContextMenu/)
    assert.match(appSource, /getProfileAppearanceHistorySource/)
    assert.match(appSource, /getRepositoryAppearanceHistorySource/)
    assert.match(appSource, /getFeatureAppearanceHistorySource/)
    assert.match(appSource, /AnchoredAppearanceEditor/)
    assert.match(
      appSource,
      /import \{ PopoverAnchorPosition \} from '\.\/lib\/popover'/
    )
    assert.match(
      appSource,
      /target\.kind === 'repository'[\s\S]*?RepositoryAppearanceElementId\.Toolbar[\s\S]*?target\.kind === 'profile'[\s\S]*?ProfileAppearanceElementId\.Toolbar/
    )
    assert.match(
      appSource,
      /return ownsToolbar[\s\S]*?PopoverAnchorPosition\.BottomLeft[\s\S]*?PopoverAnchorPosition\.RightTop/
    )
    assert.match(
      appSource,
      /anchorPosition=\{this\.getAppearanceEditorAnchorPosition\(target\)\}/
    )
    assert.doesNotMatch(appSource, /RepositorySettingsTab\.Appearance/)
    assert.match(tabStrip, /getTabStyleHistorySource/)
    assert.match(tabStrip, /getTabStyleRepositoryPath/)
    assert.match(tabStrip, /AnchoredAppearanceEditor/)
    assert.match(tab, /data-context-menu-owner="tab-title-appearance"/)
    assert.match(tab, /Customize tab appearance/)
    assert.match(brand, /data-customization-surface="app-identity"/)
  })
})
