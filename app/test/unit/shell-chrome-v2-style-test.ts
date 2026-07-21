import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('shell chrome v2 style contracts', () => {
  it('runs the dmDown entrance stagger across title bar and tab strip', () => {
    const titleBar = read('app/styles/ui/window/_title-bar.scss')
    const tabs = read('app/styles/ui/_repository-tabs.scss')

    assert.match(
      titleBar,
      /#desktop-app-title-bar\s*\{[\s\S]*?animation: dmDown calc\(460ms \* var\(--mdur, 1\)\) var\(--emph\) backwards;/
    )
    assert.match(
      tabs,
      /\.repository-tab-strip\s*\{[\s\S]*?animation: dmDown calc\(480ms \* var\(--mdur, 1\)\) var\(--emph\) backwards;[\s\S]*?animation-delay: 40ms;/
    )
  })

  it('trails the app bar with a 46px circular theme toggle', () => {
    const style = read(
      'app/styles/ui/toolbar/_one-click-commit-push-button.scss'
    )

    assert.match(
      style,
      /\.theme-toggle-button\s*\{[\s\S]*?width: 46px;[\s\S]*?height: 46px;[\s\S]*?border-radius: 999px;[\s\S]*?background: var\(--md-sys-color-surface-container-high\);/
    )
    assert.match(
      style,
      /\.theme-toggle-button\s*\{[\s\S]*?animation: dmPop calc\(560ms \* var\(--mdur, 1\)\) var\(--spring-fast\) backwards;/
    )
    assert.match(
      style,
      /\.theme-toggle-button\s*\{[\s\S]*?&:hover\s*\{[\s\S]*?background: var\(--md-sys-color-secondary-container\);[\s\S]*?border-radius: 14px;/
    )
    assert.match(
      style,
      /\.theme-toggle-button\s*\{[\s\S]*?&:active\s*\{[\s\S]*?transform: scale\(0\.88\) rotate\(-32deg\);/
    )
  })

  it('toggles explicit Light and Dark themes through the dispatcher', () => {
    const component = read('app/src/ui/toolbar/theme-toggle-button.tsx')
    const app = read('app/src/ui/app.tsx')
    const appearance = read('app/src/ui/preferences/appearance.tsx')

    assert.match(
      component,
      /const theme = nextTheme\([\s\S]*?this\.props\.selectedTheme,[\s\S]*?this\.props\.currentTheme[\s\S]*?dispatcher\.setSelectedTheme\(theme\)/
    )
    assert.match(
      component,
      /theme === ApplicationTheme\.System[\s\S]*?\? currentTheme[\s\S]*?: theme/
    )
    assert.match(component, /currentTheme: ApplicableTheme/)
    assert.match(
      component,
      /return appliedTheme === ApplicationTheme\.Light[\s\S]*?\? ApplicationTheme\.Dark[\s\S]*?: ApplicationTheme\.Light/
    )
    assert.doesNotMatch(component, /return ApplicationTheme\.System/)
    assert.match(component, /aria-label="Toggle theme"/)
    assert.match(
      component,
      /theme === ApplicationTheme\.Dark \? 'light_mode' : 'dark_mode'/
    )
    assert.match(
      component,
      /selectedTheme === ApplicationTheme\.System[\s\S]*?currentTheme[\s\S]*?<MaterialSymbol name=\{symbolForTheme\(appliedTheme\)\}/
    )
    assert.match(
      appearance,
      /supportsSystemThemeChanges\(\) \? \[ApplicationTheme\.System\] : \[\]/
    )
    // Rendered as the final item of the #desktop-app-toolbar composition.
    assert.match(
      app,
      /id="build-run"[\s\S]*?<ToolbarItem\s+id="theme-toggle"[\s\S]*?<ThemeToggleButton[\s\S]*?selectedTheme=\{this\.state\.selectedTheme\}[\s\S]*?currentTheme=\{this\.state\.currentTheme\}[\s\S]*?<\/Toolbar>/
    )
  })

  it('uses the v2 Material scrollbar geometry and outline roles on Windows', () => {
    const scroll = read('app/styles/ui/_scroll.scss')

    assert.match(
      scroll,
      /@include win32-context[\s\S]*?var\(--md-sys-color-outline\) 45%[\s\S]*?border-width: 3px/
    )
    assert.match(
      scroll,
      /&:hover,[\s\S]*?&:active[\s\S]*?border-width: 2px[\s\S]*?var\(--md-sys-color-outline\) 75%/
    )
  })

  it('keeps the tab-strip trailing cluster wired to notifications and history', () => {
    const strip = read('app/src/ui/repository-tabs/repository-tab-strip.tsx')
    const style = read('app/styles/ui/_repository-tabs.scss')

    assert.match(
      strip,
      /repository-tab-strip-trailing[\s\S]*?<NotificationBellButton[\s\S]*?repository-tab-undo[\s\S]*?repository-tab-redo/
    )
    assert.match(strip, /dispatcher\s*\n?\s*\.undoLastSettingsChange\(\)/)
    assert.match(strip, /dispatcher\s*\n?\s*\.redoLastSettingsChange\(\)/)
    assert.match(strip, /aria-label="Undo last settings change"/)
    assert.match(strip, /aria-label="Redo settings change"/)
    assert.match(
      strip,
      /setNotificationCentreOpen\(\s*!this\.props\.isNotificationCentreOpen\s*\)/
    )
    assert.match(
      style,
      /\.repository-tab-undo,\s*\n\.repository-tab-redo\s*\{[\s\S]*?width: 32px;[\s\S]*?height: 32px;[\s\S]*?border-radius: 10px;[\s\S]*?&:active\s*\{[\s\S]*?transform: scale\(0\.82\);/
    )
  })

  it('sets the Commit & push label typography', () => {
    const style = read(
      'app/styles/ui/toolbar/_one-click-commit-push-button.scss'
    )

    assert.match(
      style,
      /\.one-click-commit-push-button\s*\{[\s\S]*?\.title\s*\{[\s\S]*?font-size: 13\.5px;[\s\S]*?font-weight: 700;/
    )
    assert.match(
      style,
      /\.one-click-commit-push-button\s*\{[\s\S]*?\.description\s*\{[\s\S]*?font-size: 10\.5px;/
    )
  })

  it('sizes the tab-format popover toward the 320px envelope', () => {
    const style = read('app/styles/ui/_repository-tabs.scss')

    assert.match(style, /\.tab-style-editor\s*\{[\s\S]*?width: 288px;/)
    assert.match(
      style,
      /\.tab-style-size-value\s*\{[\s\S]*?width: 44px;[\s\S]*?text-align: right;/
    )
  })
})
