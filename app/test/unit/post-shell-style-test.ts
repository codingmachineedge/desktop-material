import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const readStyle = (name: string) =>
  readFileSync(join(process.cwd(), 'app', 'styles', 'ui', name), 'utf8')

const readRootStyle = (name: string) =>
  readFileSync(join(process.cwd(), 'app', 'styles', name), 'utf8')

const readSiteStyle = () =>
  readFileSync(join(process.cwd(), 'site', 'style.css'), 'utf8')

describe('post-shell MD3 style contracts', () => {
  it('uses system tokens instead of literal colors in the Actions log viewer', () => {
    const style = readStyle('_actions-log-viewer.scss')
    assert.doesNotMatch(style, /#[\da-f]{3,8}\b|rgba?\(/i)
    assert.match(style, /--md-sys-color-inverse-surface/)
  })

  it('keeps Actions and Agent Access responsive on narrow windows', () => {
    const actions = readStyle('_actions-view.scss')
    const actionsDialogs = readStyle('_actions-log-viewer.scss')
    assert.match(actions, /max-width: 620px/)
    assert.match(
      actions,
      /\.actions-workflow-management\s*\{[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      actions,
      /\.branch-chip\s*\{[\s\S]*?max-width: 100%;[\s\S]*?white-space: normal;[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      actionsDialogs,
      /\.actions-confirmation-dialog\s*\{[\s\S]*?width: min\(520px, 100%\);/
    )
    assert.match(readStyle('_agent-access.scss'), /max-width: 430px/)
  })

  it('keeps the History commit search input flush inside its pill', () => {
    const style = readStyle('history/_history.scss')
    assert.match(
      style,
      /\.history-commit-filter-field\s*\{[\s\S]*?flex-direction: row;/
    )
    assert.match(
      style,
      /&\.text-box-component input\s*\{[\s\S]*?min-height: 0;/
    )
  })

  it('reflows Pull all results without horizontal scrolling', () => {
    const style = readStyle('_pull-all.scss')
    assert.match(style, /\.pull-all-progress-heading/)
    assert.match(style, /\.pull-all-progress-track/)
    assert.match(style, /pull-all-results-container/)
    assert.match(style, /overflow-x: hidden/)
    assert.match(
      style,
      /> form\s*\{[\s\S]*?display: flex;[\s\S]*?overflow: hidden;/
    )
    assert.match(
      style,
      /\.dialog-content\s*\{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-height: 0;[\s\S]*?overflow: hidden;/
    )
    assert.match(
      style,
      /\.pull-all-results-container\s*\{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-height: 120px;/
    )
    assert.match(
      style,
      /grid-template-columns: minmax\(82px, 32%\) minmax\(0, 1fr\)/
    )
  })

  it('keeps Merge all content inside its dialog with reachable results', () => {
    const style = readStyle('_merge-all.scss')
    assert.doesNotMatch(style, /\.dialog-content\s*\{\s*min-width: 680px;/)
    assert.match(style, /max-width: calc\(100vw - var\(--spacing-quad\)\);/)
    assert.match(
      style,
      /\.merge-all-results-scroll\s*\{[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: hidden;/
    )
    assert.match(style, /overflow-wrap: anywhere;/)
    assert.match(
      style,
      /grid-template-columns: minmax\(72px, 30%\) minmax\(0, 1fr\)/
    )
  })

  it('keeps every Pages gallery card within a narrow mobile viewport', () => {
    const style = readSiteStyle()
    assert.match(
      style,
      /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 340px\), 1fr\)\);/
    )
    assert.match(style, /\.shot\s*\{[\s\S]*?min-width: 0;/)
    assert.match(style, /\.shot figcaption\s*\{[\s\S]*?flex-wrap: wrap;/)
  })

  it('fits Settings History at compact width and height without auto-fit', () => {
    const style = readStyle('_versioned-store-history.scss')
    assert.match(style, /max-height: calc\(100vh - 20px\);/)
    assert.match(style, /min-height: min\(480px, calc\(100vh - 20px\)\);/)
    assert.match(style, /@media \(max-height: 520px\)/)
    assert.match(
      style,
      /grid-template-rows: minmax\(80px, 40%\) minmax\(0, 1fr\);/
    )
  })

  it('shrinks and wraps the Build & Run header controls', () => {
    const style = readStyle('_material-build-run.scss')
    assert.match(
      style,
      /\.header-title\s*\{[\s\S]*?min-width: 0;[\s\S]*?text-overflow: ellipsis;/
    )
    assert.match(style, /\.build-run-panel-header\s*\{[\s\S]*?flex-wrap: wrap;/)
    assert.match(style, /@media \(max-width: 640px\), \(max-height: 420px\)/)
  })

  it('colors terminal log accents from inverse-aware tokens for AA contrast', () => {
    const style = readStyle('_material-build-run.scss')
    // The panel is an inverse-surface card, so normal-surface error/primary/
    // amber roles collapse on it; the stream accents must use the terminal
    // tokens that flip per theme (bright on the dark card, dark on the light).
    assert.match(
      style,
      /&\.stream-stderr \.line-text\s*\{\s*color: var\(--dm-term-stderr\);/
    )
    assert.match(
      style,
      /&\.stream-command \.line-text\s*\{\s*color: var\(--dm-term-command\);/
    )
    assert.match(
      style,
      /&\.stream-meta \.line-text\s*\{\s*color: var\(--dm-term-meta\);/
    )
    // Both themes define the terminal tokens.
    const tokens = readRootStyle('_material.scss')
    for (const t of ['stderr', 'command', 'meta']) {
      assert.equal(
        tokens.match(new RegExp(`--dm-term-${t}:`, 'g'))?.length,
        2,
        `--dm-term-${t} themes`
      )
    }
  })

  it('wraps long detected project names and folders in Build & Run settings', () => {
    const style = readStyle('dialogs/_repository-settings.scss')
    assert.match(
      style,
      /\.build-run-profile\s*\{[\s\S]*?min-width: 0;[\s\S]*?width: 100%;/
    )
    assert.match(
      style,
      /\.build-run-profile-text\s*\{[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      style,
      /\.build-run-profile-label\s*\{[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      style,
      /\.build-run-profile-reasons\s*\{[\s\S]*?overflow-wrap: anywhere;/
    )
  })

  it('bounds shared dialogs and keeps footer actions reachable', () => {
    const style = readStyle('_dialog-layer.scss')
    assert.match(style, /max-height: calc\(100vh - 54px\);/)
    assert.match(
      style,
      /> form\s*\{[\s\S]*?display: flex;[\s\S]*?flex: 1 1 auto;[\s\S]*?height: auto;[\s\S]*?overflow: hidden;/
    )
    assert.match(style, /> form > fieldset\s*\{[\s\S]*?display: contents;/)
    assert.match(
      style,
      /> form > fieldset > \.dialog-fieldset-content\s*\{[\s\S]*?display: flex;[\s\S]*?flex: 1 1 auto;[\s\S]*?height: auto;[\s\S]*?min-height: 0;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/
    )
    assert.match(
      style,
      /\.dialog-content\s*\{[\s\S]*?min-height: 0;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;[\s\S]*?scrollbar-gutter: stable;/
    )
    assert.match(
      style,
      /> form > fieldset > \.dialog-fieldset-content > \.dialog-content\s*\{[\s\S]*?flex: 1 1 auto;/
    )
    assert.match(
      style,
      /\.dialog-footer\s*\{[\s\S]*?max-height: min\(45vh, 220px\);[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      style,
      /\.dialog-footer \.button-group\s*\{[\s\S]*?flex-wrap: wrap;/
    )
  })

  it('keeps Repository Settings inside the viewport with a scrollable tab', () => {
    const style = readStyle('dialogs/_repository-settings.scss')
    assert.match(style, /max-height: calc\(100vh - var\(--spacing-quad\)\);/)
    assert.match(
      style,
      /\.active-tab\s*\{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/
    )
  })

  it('bounds compact Git settings and Create Branch controls horizontally', () => {
    const preferences = readStyle('_preferences.scss')
    const dialog = readStyle('_dialog.scss')

    assert.match(
      preferences,
      /\.dialog-content\.git-preferences\s*\{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;[\s\S]*?\.tab-bar\s*\{[\s\S]*?overflow-x: hidden;/
    )
    assert.match(
      preferences,
      /\.git-preferences-content\s*\{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      dialog,
      /&#create-branch\s*\{[\s\S]*?\.vertical-segmented-control,[\s\S]*?\.radio-button-component > label > span\s*\{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/
    )
    assert.match(
      dialog,
      /\.radio-button-component > label > span\s*\{[\s\S]*?overflow-wrap: anywhere;/
    )
  })

  it('keeps compact Worktree, Thank You, and accessible-only content width-safe', () => {
    const app = readStyle('_app.scss')
    const worktrees = readStyle('_worktrees.scss')
    const thankYou = readStyle('dialogs/_thank-you.scss')

    assert.match(
      app,
      /\.sr-only\s*\{[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: normal;/
    )
    assert.match(
      worktrees,
      /#add-worktree\s*\{[\s\S]*?@media \(max-width: 400px\)[\s\S]*?\.dialog-content > \.row-component:has\(> \.button-component\)[\s\S]*?flex-direction: column;[\s\S]*?\.button-component\s*\{[\s\S]*?align-self: stretch;/
    )
    assert.match(
      thankYou,
      /\.container\s*\{[\s\S]*?box-sizing: border-box;[\s\S]*?width: 100%;[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;[\s\S]*?padding-inline: clamp\(var\(--spacing-double\), 12vw, 72px\);/
    )
  })

  it('lets measured app-bar controls yield to More before they clip', () => {
    const style = readRootStyle('_material-shell.scss')

    assert.match(style, /& > \* \{\s*min-width: 0;/)
    assert.match(
      style,
      /\.resizable-component\s*\{[\s\S]*?flex: 1 1 auto;[\s\S]*?max-width: 280px !important;[\s\S]*?min-width: 0 !important;/
    )
    assert.match(
      style,
      /& > \*:has\(\.push-pull-button\)\s*\{[\s\S]*?flex: 0 1 var\(--toolbar-item-preferred-width\);[\s\S]*?min-width: 130px !important;/
    )
    assert.match(
      style,
      /& > \.toolbar-item:has\(> \.build-run-toolbar-button\)\s*\{[\s\S]*?flex: 0 1 var\(--toolbar-item-preferred-width\);[\s\S]*?min-width: 0;/
    )
    assert.match(
      style,
      /data-dm-toolbar-labels='icons'[\s\S]*?\.toolbar-item:has\(\.push-pull-button\)[\s\S]*?min-width: 48px !important;/
    )
  })

  it('themes each sync-pill state background to match its action', () => {
    const tokens = readRootStyle('_material.scss')
    const shell = readRootStyle('_material-shell.scss')
    const button = readFileSync(
      join(
        process.cwd(),
        'app',
        'src',
        'ui',
        'toolbar',
        'push-pull-button.tsx'
      ),
      'utf8'
    )

    // The component tags every state with a modifier on both pill shapes.
    assert.match(button, /`push-pull-button--\$\{state\}`/)
    for (const state of ['fetch', 'pull', 'push', 'publish', 'force-push']) {
      assert.match(button, new RegExp(`'${state}'`))
    }

    // Every state token pairs a background with its on-color, in both themes.
    for (const state of ['fetch', 'pull', 'push', 'publish', 'force-push']) {
      const bg = new RegExp(`--dm-sync-${state}-bg:`, 'g')
      const on = new RegExp(`--dm-sync-${state}-on:`, 'g')
      assert.equal(tokens.match(bg)?.length, 2, `--dm-sync-${state}-bg themes`)
      assert.equal(tokens.match(on)?.length, 2, `--dm-sync-${state}-on themes`)
    }

    // Single-button states paint the button; split states paint the wrapper.
    assert.match(
      shell,
      /\.push-pull-button\.push-pull-button--fetch > button\s*\{[\s\S]*?background: var\(--dm-sync-fetch-bg\);/
    )
    for (const state of ['publish', 'pull', 'push', 'force-push']) {
      assert.match(
        shell,
        new RegExp(
          `\\.toolbar-dropdown\\.push-pull-button--${state}\\s*\\{[\\s\\S]*?background: var\\(--dm-sync-${state}-bg\\);`
        )
      )
    }
  })

  it('contains the Changes search and composer without horizontal scrolling', () => {
    const shell = readRootStyle('_material-shell.scss')
    const changes = readStyle('changes/_changes-list.scss')
    const composer = readStyle('changes/_commit-message.scss')

    assert.match(
      shell,
      /#repository[\s\S]*?&-sidebar\s*\{[\s\S]*?\.panel\s*\{[\s\S]*?overflow-x: hidden;/
    )
    assert.match(
      changes,
      /\.header \.filter-box-container\s*\{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/
    )
    assert.match(
      composer,
      /\.commit-message-component\s*\{[\s\S]*?max-width: calc\(100% - 16px\);[\s\S]*?min-width: 0;/
    )
  })

  it('uses compact Material density without shrinking primary hit targets', () => {
    const changes = readStyle('changes/_changes-list.scss')
    const composer = readStyle('changes/_commit-message.scss')

    // v2 prototype workspace spec: roomier than the old compact density, and
    // never below a comfortable hit target.
    assert.match(
      changes,
      /\.changes-panel-header\s*\{[\s\S]*?gap: 10px;[\s\S]*?padding: 18px 18px 10px;/
    )
    assert.match(
      changes,
      /\.filter-list-filter-field\s*\{[\s\S]*?input\s*\{[\s\S]*?height: 46px;[\s\S]*?min-height: 46px;/
    )
    assert.match(
      changes,
      /\.filter-button\s*\{[\s\S]*?min-width: 40px;[\s\S]*?height: 40px;/
    )
    assert.match(
      changes,
      /\.status\s*\{[\s\S]*?width: 16px;[\s\S]*?height: 16px;[\s\S]*?padding: 2px;/
    )
    assert.match(
      composer,
      /\.commit-message-component\s*\{[\s\S]*?padding: 14px;[\s\S]*?gap: 10px;[\s\S]*?border-radius: 20px;/
    )
    assert.match(
      composer,
      /\.commit-button\s*\{[\s\S]*?height: 48px;[\s\S]*?min-height: 48px;/
    )
    assert.match(composer, /\.description-field textarea[\s\S]*?height: 46px;/)
  })

  it('keeps the repository-wide stash manager bounded and responsive', () => {
    const changes = readStyle('changes/_changes-list.scss')

    assert.match(
      changes,
      /\.stash-manager-panel\s*\{[\s\S]*?max-height: min\(62vh, 650px\);[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      changes,
      /\.stash-manager-action-grid\s*\{[\s\S]*?grid-template-columns: repeat\(auto-fit, minmax\(104px, 1fr\)\);/
    )
    assert.match(
      changes,
      /\.stash-manager-busy\s*\{[\s\S]*?position: sticky;[\s\S]*?flex-wrap: wrap;/
    )
  })

  it('keeps the expanded tab appearance editor reachable without clipping', () => {
    const style = readStyle('_repository-tabs.scss')

    assert.match(
      style,
      /\.tab-style-editor\s*\{[\s\S]*?max-width: calc\(100vw - 52px\);[\s\S]*?max-height: min\([\s\S]*?var\(--available-height, 100vh\)[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(style, /\.tab-style-buttons\s*\{[\s\S]*?flex-wrap: wrap;/)
    assert.match(
      style,
      /\.tab-style-choice,[\s\S]*?\.tab-style-toggle\s*\{[\s\S]*?min-width: 40px;[\s\S]*?height: 40px;/
    )
    assert.match(style, /@media \(max-width: 420px\), \(max-height: 560px\)/)
    assert.match(style, /&:focus-visible\s*\{[\s\S]*?outline: 2px solid/)
  })

  it('keeps the clone-style Add Submodule dialog internally scrollable', () => {
    const style = readStyle('_add-submodule.scss')

    assert.match(
      style,
      /dialog\.clone-repository\.add-submodule-dialog\s*\{[\s\S]*?max-height: calc\(100vh - 54px\);/
    )
    assert.match(
      style,
      /\.add-submodule-scroll-region\s*\{[\s\S]*?min-width: 0;[\s\S]*?min-height: 0;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      style,
      /grid-template-columns: minmax\(0, 1\.15fr\) minmax\(220px, 0\.85fr\);/
    )
    assert.match(style, /@media \(max-width: 700px\)/)
    assert.match(style, /@media \(max-width: 520px\)/)
    assert.match(style, /@media \(max-height: 650px\)/)
  })

  it('does not reintroduce the legacy short clone-dialog scroll lock', () => {
    const dialog = readStyle('_dialog.scss')
    const shortCloneRule = dialog.match(
      /@media \(max-height: 550px\)[\s\S]*?&\.clone-repository\s*\{([\s\S]*?)\n    \}/
    )?.[1]

    assert.ok(shortCloneRule, 'The short clone-dialog rule is missing')
    assert.doesNotMatch(shortCloneRule, /overflow-y:\s*unset/)
    assert.doesNotMatch(shortCloneRule, /min-height:\s*calc\(100vh/)
    assert.doesNotMatch(shortCloneRule, /max-height:\s*unset/)
  })

  it('publishes a valid floating-popover available-height token', () => {
    const source = readFileSync(
      join(process.cwd(), 'app', 'src', 'ui', 'lib', 'popover.tsx'),
      'utf8'
    )

    assert.match(
      source,
      /const newMaxHeight\s*=\s*maxHeight === undefined\s*\? availableHeight\s*:\s*Math\.min\(availableHeight, maxHeight\)/
    )
    assert.match(
      source,
      /setProperty\(\s*'--available-height',\s*`\$\{newMaxHeight\}px`\s*\)/
    )
  })
})
