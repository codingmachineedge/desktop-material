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
})
