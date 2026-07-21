import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('v2 shell Material Symbol contracts', () => {
  it('migrates the golden app-bar controls without changing their labels', () => {
    const app = read('app/src/ui/app.tsx')
    const branch = read('app/src/ui/toolbar/branch-dropdown.tsx')
    const dropdown = read('app/src/ui/toolbar/dropdown.tsx')
    const sync = read('app/src/ui/toolbar/push-pull-button.tsx')
    const commitPush = read(
      'app/src/ui/toolbar/one-click-commit-push-button.tsx'
    )
    const theme = read('app/src/ui/toolbar/theme-toggle-button.tsx')

    assert.match(
      app,
      /<ToolbarDropdown[\s\S]*?materialSymbol="book_2"[\s\S]*?materialSymbolSize=\{19\}[\s\S]*?title=\{title\}[\s\S]*?Current repository/
    )
    assert.match(branch, /materialSymbol: MaterialSymbolName[^]*?'alt_route'/)
    assert.match(branch, /materialSymbol = 'progress_activity'/)
    assert.match(branch, /materialSymbolSize=\{19\}/)
    assert.match(
      dropdown,
      /name="keyboard_arrow_down"[^]*?size=\{20\}[^]*?className="dropdownArrow"/
    )
    assert.doesNotMatch(dropdown, /triangle(?:Up|Down)/)
    assert.match(sync, /materialSymbol="sync"[^]*?materialSymbolSize=\{22\}/)
    assert.match(
      sync,
      /materialSymbol="arrow_upward"[^]*?materialSymbolSize=\{22\}/
    )
    assert.match(
      sync,
      /materialSymbol="progress_activity"[^]*?materialSymbolSize=\{22\}/
    )
    assert.match(
      commitPush,
      /phase === null \? 'auto_awesome' : 'progress_activity'/
    )
    assert.match(commitPush, /materialSymbolSize=\{21\}/)
    assert.match(commitPush, /title=\{title\}/)
    assert.match(theme, /symbolForTheme\(appliedTheme\)[^]*?size=\{22\}/)
    assert.match(
      theme,
      /selectedTheme === ApplicationTheme\.System[^]*?\? currentTheme[^]*?: selectedTheme/
    )
  })

  it('uses Material Symbols for only the v2 core rail destinations', () => {
    const repository = read('app/src/ui/repository.tsx')
    const railStyle = read('app/styles/ui/_material-rail.scss')

    for (const name of [
      'difference',
      'history',
      'rocket_launch',
      'alt_route',
      'settings',
    ]) {
      assert.match(repository, new RegExp(`name="${name}"`))
    }

    assert.match(repository, /aria-label="Branches"/)
    assert.match(repository, /aria-label="Settings"/)
    // Extension-only destinations deliberately stay in the Octicon system.
    assert.match(repository, /id="releases-tab"[^]*?octicons\.tag/)
    assert.match(repository, /id="issues-tab"[^]*?octicons\.issueOpened/)
    assert.match(
      railStyle,
      /\.rail-icon[^]*?\.material-symbol[^]*?transition: font-variation-settings 260ms var\(--emph\);/
    )
  })

  it('restores the prototype sell glyph to History tag chips', () => {
    const row = read('app/src/ui/history/commit-list-item.tsx')
    const detail = read('app/src/ui/history/expandable-commit-summary.tsx')
    const style = read('app/styles/ui/history/_commit-list.scss')

    assert.match(
      row,
      /tag-name[^]*?<MaterialSymbol name="sell" size=\{13\}[^]*?<span className="tag-label">\{firstTag\}<\/span>/
    )
    assert.match(detail, /ecs-meta-item tags selectable[^]*?name="sell"/)
    assert.match(style, /\.tag-indicator \.tag-name[^]*?gap: 4px;/)
    assert.match(
      style,
      /\.tag-label[^]*?min-width: 0;[^]*?overflow: hidden;[^]*?text-overflow: ellipsis;[^]*?white-space: nowrap;/
    )
  })
})
