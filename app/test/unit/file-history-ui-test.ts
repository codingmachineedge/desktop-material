import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('File History native UI contracts', () => {
  it('wires one shared native action into working and committed file menus', () => {
    const changes = read('app/src/ui/changes/filter-changes-list.tsx')
    const commits = read('app/src/ui/history/selected-commits.tsx')
    const menu = read('app/src/ui/file-history/file-history-menu.ts')

    assert.match(changes, /createFileHistoryMenuItem\(/)
    assert.match(commits, /createFileHistoryMenuItem\(/)
    assert.match(menu, /PopupType\.FileHistory/)
    assert.match(menu, /repository, path/)
  })

  it('keeps page chrome contained and grants horizontal scroll only to source', () => {
    const style = read('app/styles/ui/_file-history.scss')

    assert.match(
      style,
      /\.file-history-panel\s*\{[\s\S]*?overflow: hidden;[\s\S]*?container-name: file-history-panel;/
    )
    assert.match(
      style,
      /\.file-history-master,[\s\S]*?\.file-history-details\s*\{[\s\S]*?overflow-x: hidden;/
    )
    assert.match(style, /\.file-blame-source\s*\{[\s\S]*?overflow: auto;/)
    assert.match(
      style,
      /@container file-history-panel \(max-width: 620px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      style,
      /\.file-history-details-card dl,[\s\S]*?\.file-blame-details-card dl[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    )
  })

  it('falls back to unified scrolling and wraps source on constrained canvases', () => {
    const style = read('app/styles/ui/_file-history.scss')

    assert.match(
      style,
      /@container file-history-panel \(max-width: 460px\)[\s\S]*?\.file-blame-lines\s*\{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;/
    )
    assert.match(
      style,
      /@container file-history-panel \(max-width: 460px\)[\s\S]*?\.file-blame-line\s*\{[\s\S]*?min-width: 0;[\s\S]*?grid-template-columns: 92px 52px minmax\(0, 1fr\);[\s\S]*?> code\s*\{[\s\S]*?overflow-wrap: anywhere;[\s\S]*?white-space: pre-wrap;/
    )
    assert.match(
      style,
      /@media \(max-height: 320px\)[\s\S]*?\.file-history-panel\s*\{[\s\S]*?overflow-y: auto;[\s\S]*?\.file-history-content\s*\{[\s\S]*?flex: 0 0 auto;[\s\S]*?overflow: visible;/
    )
    assert.match(
      style,
      /@media \(max-height: 320px\)[\s\S]*?\.file-history-layout\s*\{[\s\S]*?height: auto;[\s\S]*?overflow: visible;[\s\S]*?grid-template-rows: auto auto;[\s\S]*?\.file-history-master,[\s\S]*?\.file-history-details\s*\{[\s\S]*?overflow: visible;/
    )
  })

  it('exposes tabs, keyboard focus, ARIA selection, and bounded retry states', () => {
    const ui = read('app/src/ui/file-history/file-history.tsx')

    assert.match(ui, /role="tablist"/)
    assert.match(ui, /event\.key !== 'ArrowLeft'/)
    assert.match(ui, /event\.key === 'ArrowDown'/)
    assert.match(ui, /data-blame-index=/)
    assert.match(ui, /role="listbox"/)
    assert.match(ui, /aria-selected=/)
    assert.match(ui, /aria-live="polite"/)
    assert.match(ui, /controller\.signal/)
    assert.match(ui, />\s*Retry/)
  })

  it('restores a reviewed commit version without exposing raw Git input', () => {
    const ui = read('app/src/ui/file-history/file-history.tsx')
    const git = read('app/src/lib/git/file-history.ts')
    const style = read('app/styles/ui/_file-history.scss')

    assert.match(ui, />\s*Restore this version/)
    assert.match(ui, /role="alertdialog"/)
    assert.match(ui, /restoreFileFromCommit\(/)
    assert.match(ui, /onRefreshRepository\(\)/)
    assert.match(
      git,
      /\['restore', `--source=\$\{sha\}`, '--worktree', '--', path\]/
    )
    assert.match(
      style,
      /\.file-history-restore-confirmation[\s\S]*overflow-x: hidden/
    )
    assert.doesNotMatch(ui, /command arguments|role="searchbox"/i)
  })
})
