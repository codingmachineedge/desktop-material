import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (...parts: ReadonlyArray<string>) =>
  readFileSync(join(process.cwd(), ...parts), 'utf8')

/**
 * Too-big geometry contracts: content that grows (wrapped sync descriptions,
 * count badges, side-sheet row chrome) must grow or contain its box instead of
 * clipping it, and virtualized row slots must match what their rows draw.
 */
describe('sheet and pill geometry contracts', () => {
  it('lets app-bar chips grow with wrapped content in every mode', () => {
    const shell = read('app', 'styles', '_material-shell.scss')

    // The escape hatch must out-specify the upstream `.resizable` cap so a
    // wrapped sync description can grow a resizable pill too.
    assert.match(
      shell,
      /\.toolbar-button,\s*\.toolbar-button\.resizable\s*\{\s*max-height: none;/
    )

    // The chip base and the compact-density variant are minimums, never fixed
    // heights: a fixed compact 44px would be clamped back up by the base 54px
    // minimum and would clip two-line sync descriptions.
    assert.match(shell, /min-height: 54px;/)
    assert.match(
      shell,
      /body\[data-dm-toolbar-density='compact'\] #desktop-app-toolbar \{[\s\S]*?min-height: 44px;/
    )
    assert.doesNotMatch(shell, /(?<!min-)height: 44px/)
  })

  it('keeps icons-only chips inside their 92px caps', () => {
    const shell = read('app', 'styles', '_material-shell.scss')
    assert.match(
      shell,
      /body\[data-dm-toolbar-labels='icons'\] #desktop-app-toolbar \{[\s\S]*?\.toolbar-button\.push-pull-button,\s*& > \.toolbar-item \.toolbar-button\.branch-toolbar-button,\s*& > \.toolbar-item \.toolbar-button\.revert-progress \{\s*min-width: 0;/
    )
  })

  it('never shrinks the ahead/behind badge below its counts', () => {
    const badge = read(
      'app',
      'styles',
      'ui',
      'toolbar',
      '_push-pull-button.scss'
    )
    assert.match(
      badge,
      /\.push-pull-button \.ahead-behind \{[\s\S]*?flex: none;/
    )
  })

  it('sizes repository side-sheet slots to the rows they draw', () => {
    const list = read(
      'app',
      'src',
      'ui',
      'repositories-list',
      'repositories-list.tsx'
    )
    const style = read('app', 'styles', 'ui', '_repository-list.scss')

    // TS slot heights mirror the sheet SCSS: 34px chip + 2×10px padding
    // (comfortable) and 28px chip + 2×5px (compact density).
    assert.match(list, /const RowHeight = 54/)
    assert.match(list, /const CompactRowHeight = 38/)
    assert.match(list, /const GroupHeaderRowHeight = 36/)
    assert.match(list, /rowHeight=\{this\.getRowHeight\}/)
    assert.match(
      style,
      /\.repository-list-item \{\s*padding: 10px 12px;[\s\S]*?height: 34px;/
    )
    assert.match(
      style,
      /body\[data-dm-repository-list-density='compact'\][\s\S]*?padding-block: 5px;[\s\S]*?height: 28px;/
    )
  })

  it('sizes branch side-sheet slots to the rows they draw', () => {
    const branchList = read('app', 'src', 'ui', 'branches', 'branch-list.tsx')
    const container = read(
      'app',
      'src',
      'ui',
      'branches',
      'branches-container.tsx'
    )
    const style = read('app', 'styles', 'ui', '_branches.scss')

    // Dialog consumers keep the default 30px; the sheet passes its own
    // geometry: a 22px content line + 2×10px padding (v2 prototype inset).
    assert.match(branchList, /const RowHeight = 30/)
    assert.match(
      branchList,
      /rowHeight=\{this\.props\.rowHeight \?\? RowHeight\}/
    )
    assert.match(container, /const SheetRowHeight = 42/)
    assert.match(container, /rowHeight=\{this\.getSheetRowHeight\}/)
    assert.match(
      style,
      /#foldout-container[\s\S]*?\.branches-list-item \{[\s\S]*?padding: 10px 12px;[\s\S]*?\.icon \{[\s\S]*?width: 19px;[\s\S]*?height: 19px;/
    )
  })
})
