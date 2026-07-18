import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const read = (...segments: ReadonlyArray<string>) =>
  readFileSync(join(process.cwd(), 'app', ...segments), 'utf8')

describe('material context menu contracts', () => {
  it('routes non-spellcheck menus through the Material menu with a native fallback', () => {
    const menuItem = read('src', 'lib', 'menu-item.ts')

    assert.match(menuItem, /if \(!addSpellCheckMenu\) \{/)
    assert.match(menuItem, /showMaterialContextMenu\(items\)/)
    assert.match(menuItem, /falling back to native/)
    // The native path stays intact for spell-checked text fields.
    assert.match(menuItem, /invokeContextualMenu\(/)
    // Octicon descriptors never reach Electron's icon option.
    assert.match(menuItem, /icon: undefined/)
  })

  it('renders an M3 surface with a type-to-filter bar and icon slots', () => {
    const component = read('src', 'ui', 'lib', 'material-context-menu.tsx')
    assert.match(component, /className="context-menu-filter"/)
    assert.match(component, /placeholder="Filter actions"/)
    assert.match(component, /context-menu-item-leading/)
    assert.match(component, /performRole/)

    const styles = read('styles', 'ui', '_material-context-menu.scss')
    assert.match(
      styles,
      /\.material-context-menu\s*\{[\s\S]*?background: var\(--md-sys-color-surface-container\);/
    )
    assert.match(styles, /\.context-menu-filter/)

    const manifest = read('styles', '_ui.scss')
    assert.match(manifest, /@import 'ui\/material-context-menu';/)
  })

  it('filters through the shared filter-mode cluster in its compact form', () => {
    const component = read('src', 'ui', 'lib', 'material-context-menu.tsx')
    assert.match(component, /<FilterModeControl/)
    assert.match(component, /matchWithMode/)
    assert.match(component, /ContextMenuFilterListId = 'material-context-menu'/)

    const styles = read('styles', 'ui', '_material-context-menu.scss')
    assert.match(
      styles,
      /\.context-menu-filter\s*\{[\s\S]*?\.filter-regex-builder-label\s*\{\s*display: none;/
    )
  })

  it('gives the flagship context menus leading icons', () => {
    const tabStrip = read(
      'src',
      'ui',
      'repository-tabs',
      'repository-tab-strip.tsx'
    )
    assert.match(tabStrip, /icon: octicons\.pin,/)
    assert.match(tabStrip, /icon: octicons\.x,/)

    const commitList = read('src', 'ui', 'history', 'commit-list.tsx')
    assert.match(commitList, /icon: octicons\.gitBranch,/)
    assert.match(commitList, /icon: octicons\.copy,/)
    assert.match(commitList, /icon: octicons\.fileDirectory,/)
  })
})
