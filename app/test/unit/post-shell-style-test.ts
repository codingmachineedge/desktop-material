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
      /\.branch-chip\s*\{[\s\S]*?max-width: min\(100%, 220px\);[\s\S]*?text-overflow: ellipsis;/
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
    assert.match(style, /pull-all-results-container/)
    assert.match(style, /overflow-x: hidden/)
    assert.match(style, /grid-template-columns: minmax\(82px, 32%\) minmax\(0, 1fr\)/)
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
    assert.match(
      style,
      /min-height: min\(480px, calc\(100vh - 20px\)\);/
    )
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
    assert.match(
      style,
      /\.build-run-panel-header\s*\{[\s\S]*?flex-wrap: wrap;/
    )
    assert.match(style, /@media \(max-width: 640px\), \(max-height: 420px\)/)
  })

  it('bounds shared dialogs and keeps footer actions reachable', () => {
    const style = readStyle('_dialog-layer.scss')
    assert.match(style, /max-height: calc\(100vh - 54px\);/)
    assert.match(
      style,
      /\.dialog-content\s*\{[\s\S]*?min-height: 0;[\s\S]*?overflow-x: hidden;/
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

  it('keeps every app-bar control inside 1443x992 and 1450x997 viewports', () => {
    const style = readRootStyle('_material-shell.scss')

    assert.match(style, /& > \* \{\s*min-width: 0;/)
    assert.match(
      style,
      /\.resizable-component\s*\{[\s\S]*?flex: 1 1 180px;[\s\S]*?max-width: 280px !important;[\s\S]*?min-width: 0 !important;/
    )
    assert.match(
      style,
      /& > \*:has\(\.push-pull-button\)\s*\{[\s\S]*?flex: 0 1 230px;[\s\S]*?min-width: 130px !important;/
    )
    assert.match(
      style,
      /& > \.build-run-toolbar-button\s*\{[\s\S]*?flex: 0 1 210px;[\s\S]*?min-width: 0;/
    )
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
      /\.commit-message-component\s*\{[\s\S]*?max-width: calc\(100% - 24px\);[\s\S]*?min-width: 0;/
    )
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
})
