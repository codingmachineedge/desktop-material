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
    assert.match(shell, /data-dm-toolbar-typography/)
    assert.match(shell, /--dm-toolbar-text-color/)
    assert.match(shell, /--dm-toolbar-font-family/)
    assert.match(shell, /--dm-toolbar-title-font-size/)
    assert.match(shell, /--dm-toolbar-text-align/)
    assert.match(list, /data-dm-repository-list-density='compact'/)
    assert.match(tabs, /data-dm-tab-density='compact'/)
    assert.match(tabs, /data-dm-tab-width='wide'/)
    assert.match(tabs, /data-dm-tab-close-buttons='always'/)
  })

  it('gates explicit Desktop Material feature markers behind the profile toggle', async () => {
    const [
      highlights,
      appearance,
      repository,
      preferences,
      repositoryTabs,
      notificationBell,
    ] = await Promise.all([
      readFile(Path.join(styles, 'ui/_feature-highlights.scss'), 'utf8'),
      readFile(Path.join(app, 'src/ui/preferences/appearance.tsx'), 'utf8'),
      readFile(Path.join(app, 'src/ui/repository.tsx'), 'utf8'),
      readFile(Path.join(app, 'src/ui/preferences/preferences.tsx'), 'utf8'),
      readFile(
        Path.join(app, 'src/ui/repository-tabs/repository-tab-strip.tsx'),
        'utf8'
      ),
      readFile(
        Path.join(app, 'src/ui/notifications/notification-bell-button.tsx'),
        'utf8'
      ),
    ])

    assert.doesNotMatch(highlights, /body\[data-dm-highlight-features\]/)
    assert.match(
      highlights,
      /\[data-dm-feature\]\[data-dm-feature-highlighted\]/
    )
    assert.doesNotMatch(highlights, /@keyframes|animation:/)
    assert.match(highlights, /content: 'M'/)
    assert.match(highlights, /content: 'Material'/)
    assert.match(
      highlights,
      /@container preferences-dialog \(max-width: 620px\)[\s\S]*?content: 'M'/
    )
    assert.match(
      highlights,
      /\.repository-tab-strip button\[data-dm-feature\]\[data-dm-feature-highlighted\][\s\S]*?box-shadow:/
    )
    assert.doesNotMatch(appearance, /Highlight Desktop Material features/)

    for (const id of [
      'actions-tab',
      'releases-tab',
      'issues-tab',
      'github-api-tab',
      'triage-tab',
      'repository-tools-tab',
    ]) {
      assert.match(
        repository,
        new RegExp(`id="${id}"[\\s\\S]*?data-dm-feature=\\{true\\}`)
      )
    }

    assert.match(preferences, /data-dm-feature=\{isFeature \|\| undefined\}/)
    assert.match(
      preferences,
      /renderRailTab\(\s*PreferencesTab\.AgentAccess,[\s\S]*?true\s*\)/
    )
    assert.match(
      preferences,
      /renderRailTab\(\s*PreferencesTab\.Automation,[\s\S]*?true\s*\)/
    )

    for (const className of [
      'repository-tab-search',
      'repository-tab-arrange',
      'repository-tab-new',
      'repository-tab-undo',
      'repository-tab-redo',
    ]) {
      assert.match(
        repositoryTabs,
        new RegExp(
          `className="${className}"[\\s\\S]*?data-dm-feature=\\{true\\}`
        )
      )
    }
    assert.match(notificationBell, /data-dm-feature=\{true\}/)
  })

  it('routes custom visuals to element-owned anchored editors', async () => {
    const [appearance, preferences] = await Promise.all([
      readFile(Path.join(app, 'src/ui/preferences/appearance.tsx'), 'utf8'),
      readFile(Path.join(styles, 'ui/_preferences.scss'), 'utf8'),
    ])

    assert.match(appearance, /className="appearance-scope-note"/)
    assert.match(appearance, /role="note"/)
    assert.match(appearance, /right-click that element/)
    assert.match(appearance, /Each element keeps its settings/)

    assert.match(
      preferences,
      /\.appearance-scope-note\s*\{[\s\S]*?var\(--md-sys-color-secondary-container\)/
    )
    assert.match(
      preferences,
      /\.appearance-scope-note-icon\s*\{[\s\S]*?var\(--md-sys-color-primary-container\)/
    )
  })

  it('keeps the app identity editor rich, labelled, and responsive', async () => {
    const [editor, brand, titleBar, preferences, appBar] = await Promise.all([
      readFile(Path.join(app, 'src/ui/preferences/app-identity.tsx'), 'utf8'),
      readFile(Path.join(app, 'src/ui/window/app-brand.tsx'), 'utf8'),
      readFile(Path.join(app, 'src/ui/window/title-bar.tsx'), 'utf8'),
      readFile(Path.join(styles, 'ui/_preferences.scss'), 'utf8'),
      readFile(Path.join(styles, 'ui/window/_material-app-bar.scss'), 'utf8'),
    ])

    for (const label of [
      'App name',
      'Custom logo image',
      'Logo shape',
      'Logo color',
      'Logo border',
      'Logo shadow',
      'Logo size',
      'Logo rotation',
      'Logo and name gap',
      'Font',
      'Weight',
      'Font width',
      'Letter case',
      'Text effect',
      'Name highlight',
      'Name size',
      'Character spacing',
      'Name opacity',
      'Name color',
      'Highlight color',
    ]) {
      assert.match(editor, new RegExp(label))
    }
    for (const format of [
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Small caps',
    ]) {
      assert.match(editor, new RegExp(`'${format}'`))
    }

    assert.match(titleBar, /<AppBrand identity=\{this\.props\.appIdentity\}/)
    assert.match(brand, /appNameStyleToCss/)
    assert.match(brand, /appLogoStyleToCss/)
    assert.match(
      preferences,
      /\.app-identity-section\s*\{[\s\S]*?min-width: 0;/
    )
    assert.match(
      preferences,
      /@container preferences-pane \(max-width: 520px\)[\s\S]*?\.app-identity-logo-controls,[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      appBar,
      /\.app-brand\s*\{[\s\S]*?min-width: 0;[\s\S]*?text-overflow: ellipsis;/
    )
  })
})
