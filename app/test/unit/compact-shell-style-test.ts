import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('compact shell style contracts', () => {
  it('keeps the low-height repository rail vertically reachable', () => {
    const style = read('app/styles/ui/_material-rail.scss')

    assert.match(
      style,
      /\.repository-rail\s*\{[\s\S]*?min-height: 0;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      style,
      /\.tab-bar\.vertical\s*\{[\s\S]*?max-width: 100%;[\s\S]*?padding: 0;[\s\S]*?width: 100%;/
    )
    assert.match(style, /@media \(max-height: 520px\)/)
    assert.match(
      style,
      /\.tab-bar\.vertical \.tab-bar-item,[\s\S]*?min-height: 40px;/
    )
    assert.match(
      style,
      /\.rail-label\s*\{[\s\S]*?clip-path: inset\(50%\);[\s\S]*?white-space: nowrap;/
    )
  })

  it('keeps diff header actions inside the minimum 200%-zoom pane', () => {
    const style = read('app/styles/ui/_diff.scss')

    assert.match(
      style,
      /@media \(max-width: 420px\) and \(max-height: 320px\)[\s\S]*?\.diff-container \.header\s*\{[\s\S]*?gap: 4px;[\s\S]*?padding: 6px 8px;[\s\S]*?\.diff-line-stats\s*\{[\s\S]*?display: none;/
    )
  })

  it('keeps Actions, Releases, and changed-file rows reachable in short panes', () => {
    const cards = read('app/styles/ui/_material-cards.scss')
    const changes = read('app/styles/ui/changes/_changes-list.scss')

    assert.match(
      cards,
      /:not\(\.github-api-explorer\):not\(\.actions-view\):not\(\.github-releases-view\)\s*\{[\s\S]*?overflow: hidden;/
    )
    const actions = read('app/styles/ui/_actions-view.scss')
    assert.match(
      actions,
      /@media \(max-width: 620px\)[\s\S]*?\.actions-run-pagination\s*\{[\s\S]*?flex-direction: column;[\s\S]*?> span\s*\{[\s\S]*?flex-basis: auto;/
    )
    assert.match(
      changes,
      /\.filtered-changes-list\s*\{[\s\S]*?min-height: 148px;/
    )
  })

  it('keeps the bilingual Cheap LFS terminal inside a narrow sidebar', () => {
    const commitMessage = read('app/styles/ui/changes/_commit-message.scss')

    assert.match(
      commitMessage,
      /\.cheap-lfs-mini-terminal\s*\{[\s\S]*?container-type: inline-size;/
    )
    assert.match(
      commitMessage,
      /@container \(max-width: 220px\)[\s\S]*?\.cheap-lfs-terminal-active-detail,[\s\S]*?text-overflow: ellipsis;[\s\S]*?\.cheap-lfs-terminal-details\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/
    )
    assert.match(
      commitMessage,
      /\.cheap-lfs-terminal-facts\s*\{[\s\S]*?flex-wrap: wrap;[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      commitMessage,
      /\.cheap-lfs-terminal-recommendation\s*\{[\s\S]*?font-size: 10px;[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      commitMessage,
      /\.cheap-lfs-mini-terminal-body\s*\{[\s\S]*?max-height: min\(180px, 32vh\);[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;/
    )
    assert.match(
      commitMessage,
      /\.cheap-lfs-terminal-recommendation\s*\{[\s\S]*?> summary[\s\S]*?> span[\s\S]*?-webkit-line-clamp: 2;[\s\S]*?&:focus-visible[\s\S]*?outline:/
    )
    assert.match(
      commitMessage,
      /&\[open\] > summary > span,[\s\S]*?> summary:focus-visible > span[\s\S]*?-webkit-line-clamp: unset;/
    )
    assert.match(
      commitMessage,
      /@container \(max-width: 220px\)[\s\S]*?\.cheap-lfs-terminal-facts\s*\{[\s\S]*?display: grid;/
    )
    assert.match(
      commitMessage,
      /@media \(max-height: 620px\)[\s\S]*?\.cheap-lfs-mini-terminal-header\s*\{[\s\S]*?display: none;[\s\S]*?\.cheap-lfs-mini-terminal-body\s*\{[\s\S]*?max-height: min\(132px, 28vh\);[\s\S]*?\.cheap-lfs-terminal-recommendation\s*\{[\s\S]*?> summary > span[\s\S]*?-webkit-line-clamp: 1;/
    )
  })

  it('uses reversible repository master-detail layouts at 200% zoom', () => {
    const shell = read('app/styles/_material-shell.scss')
    const rail = read('app/styles/ui/_material-rail.scss')
    const repository = read('app/src/ui/repository.tsx')

    assert.match(
      shell,
      /@media \(max-width: 420px\) and \(max-height: 320px\)[\s\S]*?#repository:has\(> \.diff-container\) > \.focus-container,[\s\S]*?#repository:has\(> #history\) > \.focus-container\s*\{[\s\S]*?display: none;/
    )
    assert.match(
      shell,
      /@media \(max-width: 420px\) and \(max-height: 320px\)[\s\S]*?#repository:has\(> #history\) > #history\s*\{[\s\S]*?max-height: 100%;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;[\s\S]*?scrollbar-gutter: stable;[\s\S]*?#expandable-commit-summary,[\s\S]*?\.commit-details\s*\{[\s\S]*?flex: 0 0 auto;/
    )
    assert.match(
      rail,
      /\.compact-changes-list-button,[\s\S]*?\.compact-history-list-button\s*\{[\s\S]*?display: none;[\s\S]*?@media \(max-width: 420px\) and \(max-height: 320px\)[\s\S]*?\.repository-rail \.compact-changes-list-button,[\s\S]*?\.repository-rail \.compact-history-list-button\s*\{[\s\S]*?display: flex;/
    )
    assert.match(
      repository,
      /onShowChangesList[\s\S]*?selectWorkingDirectoryFiles\([\s\S]*?this\.props\.repository,[\s\S]*?\[\][\s\S]*?compact-changes-list-button/
    )
    assert.match(
      repository,
      /onShowHistoryList[\s\S]*?changeCommitSelection\([\s\S]*?this\.props\.repository,[\s\S]*?\[\],[\s\S]*?true[\s\S]*?compact-history-list-button/
    )
    assert.match(repository, /aria-label="Show changed files"/)
    assert.match(repository, /aria-label="Show commit list"/)
  })

  it('preserves whole app-bar hit targets and accessible compact labels', () => {
    const style = read('app/styles/_material-shell.scss')
    const toolbar = read('app/styles/ui/toolbar/_toolbar.scss')
    const component = read('app/src/ui/toolbar/button.tsx')

    assert.match(style, /@media \(max-width: 760px\), \(max-height: 420px\)/)
    assert.match(
      style,
      /& > \.toolbar-item \.toolbar-button,[\s\S]*?width: 48px !important;[\s\S]*?min-width: 40px !important;/
    )
    assert.match(
      style,
      /& > \.toolbar-item\.sidebar-section,[\s\S]*?& > \.toolbar-item:has\(> \.resizable-component\)\s*\{[\s\S]*?flex: 0 1 auto;/
    )
    assert.match(
      style,
      /> button\s*\{[\s\S]*?min-height: 40px;[\s\S]*?\.text\s*\{[\s\S]*?clip-path: inset\(50%\);/
    )
    assert.match(style, /#desktop-app-toolbar\.toolbar-overflow-exhausted/)
    assert.match(
      style,
      /data-dm-toolbar-labels='icons'[\s\S]*?\.toolbar-item:has\(\.push-pull-button\)[\s\S]*?\.ahead-behind\s*\{[\s\S]*?clip-path: inset\(50%\);[\s\S]*?position: absolute;/
    )
    assert.doesNotMatch(style, /#desktop-app-toolbar\s*\{\s*flex-wrap: wrap;/)
    assert.match(style, /\.toolbar-overflow-popover\s*\{/)
    assert.match(
      toolbar,
      /&\.is-overflowed\s*\{[\s\S]*?position: fixed !important;[\s\S]*?visibility: hidden;/
    )
    assert.match(
      toolbar,
      /\.toolbar-overflow-control\s*\{[\s\S]*?flex: 0 0 48px;/
    )
    assert.match(component, /\{this\.renderText\(\)\}/)
  })

  it('wraps finite sync descriptions while retaining responsive icon controls', () => {
    const style = read('app/styles/_material-shell.scss')

    assert.match(
      style,
      /\.push-pull-button > button\s*\{[\s\S]*?\.description\s*\{[\s\S]*?overflow: visible;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?text-overflow: clip;[\s\S]*?white-space: normal;/
    )
  })
})
