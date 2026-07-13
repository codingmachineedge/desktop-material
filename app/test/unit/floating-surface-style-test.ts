import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('floating surface layout contracts', () => {
  it('portals and viewport-bounds the pull-request quick view', () => {
    const component = read('app/src/ui/pull-request-quick-view.tsx')
    const style = read('app/styles/ui/_pull-request-quick-view.scss')

    assert.match(component, /ReactDOM\.createPortal\(/)
    assert.match(component, /calculatePullRequestQuickViewGeometry\(/)
    assert.match(style, /position: fixed;/)
    assert.match(style, /max-width: calc\(100vw - 16px\);/)
    assert.match(style, /overflow-x: hidden;/)
  })

  it('clamps anchored foldouts and contracts the Worktree surface', () => {
    const dropdown = read('app/src/ui/toolbar/dropdown.tsx')
    const foldout = read('app/styles/ui/_foldout.scss')

    assert.match(dropdown, /getViewportSafeFoldoutLeft\(/)
    assert.match(dropdown, /window\.addEventListener\('resize'/)
    assert.match(
      foldout,
      /\.foldout:has\(\.worktree-list\)[\s\S]*?min-width: min\(365px, calc\(100vw - 16px\)\) !important;/
    )
  })

  it('keeps Regex Builder controls reachable and reuses dialog clamping', () => {
    const component = read(
      'app/src/ui/lib/regex-builder/regex-builder.tsx'
    )
    const style = read('app/styles/ui/_regex-builder.scss')

    assert.match(component, /clampDialogOffset\(/)
    assert.match(component, /className="regex-builder-scroll-region"/)
    assert.match(component, /onPointerCancel=\{this\.onHeaderPointerUp\}/)
    assert.match(
      style,
      /\.regex-builder-scroll-region\s*\{[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(style, /@media \(max-width: 620px\)/)
    assert.match(style, /@media \(max-height: 420px\)/)
  })

  it('guards long side-sheet and notification text', () => {
    const foldout = read('app/styles/ui/_foldout.scss')
    const notifications = read('app/styles/ui/_notification-centre.scss')

    assert.match(
      foldout,
      /\.side-sheet-title\s*\{[\s\S]*?min-width: 0;[\s\S]*?text-overflow: ellipsis;/
    )
    assert.match(
      notifications,
      /\.notification-item-title\s*\{[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      notifications,
      /\.notification-item-text\s*\{[\s\S]*?overflow-wrap: anywhere;/
    )
  })
})
