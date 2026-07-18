import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const branchesStyle = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_branches.scss'),
  'utf8'
)
const foldoutStyle = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_foldout.scss'),
  'utf8'
)
const branchesContainer = readFileSync(
  join(process.cwd(), 'app', 'src', 'ui', 'branches', 'branches-container.tsx'),
  'utf8'
)
const branchList = readFileSync(
  join(process.cwd(), 'app', 'src', 'ui', 'branches', 'branch-list.tsx'),
  'utf8'
)
const noPullRequests = readFileSync(
  join(process.cwd(), 'app', 'src', 'ui', 'branches', 'no-pull-requests.tsx'),
  'utf8'
)

describe('repository + branch side sheets v2 styles', () => {
  it('renders branch rows with a bare 19px glyph instead of a tonal chip', () => {
    assert.match(
      branchesStyle,
      /#foldout-container \.branches-container[\s\S]*?\.branches-list-item\s*\{[\s\S]*?padding: 10px 12px;[\s\S]*?\.icon\s*\{[\s\S]*?width: 19px;[\s\S]*?height: 19px;[\s\S]*?background: transparent;[\s\S]*?color: var\(--md-sys-color-on-surface-variant\);/
    )
    // The 34x34 tonal chip and its current-branch tint are gone; the current
    // branch is marked only by the trailing check_circle.
    assert.ok(!branchesStyle.includes('width: 34px'))
    assert.doesNotMatch(branchesStyle, /current-branch \.icon/)
    assert.match(
      branchesStyle,
      /\.current-branch-indicator\s*\{[\s\S]*?color: var\(--md-sys-color-primary\);[\s\S]*?animation: dmPop/
    )
  })

  it('recomputes the sheet row height for the bare-glyph row geometry', () => {
    assert.match(branchesContainer, /export const SheetRowHeight = 42/)
    // The geometry comment stays accurate: 10px padding × 2 around a 22px line.
    assert.match(branchesContainer, /10 \+ 22 \+ 10 = 42/)
    assert.match(branchesContainer, /rowHeight=\{this\.getSheetRowHeight\}/)
    assert.match(
      branchList,
      /rowHeight=\{this\.props\.rowHeight \?\? RowHeight\}/
    )
    // The SCSS line box matches the constant: 22px name line inside 10px pads.
    assert.match(
      branchesStyle,
      /\.name\s*\{[\s\S]*?font-family: var\(--font-family-monospace\);[\s\S]*?line-height: 22px;/
    )
  })

  it('animates the New-branch FAB with the prototype dmPop timing and 8px glyph gap', () => {
    assert.match(
      branchesStyle,
      /\.new-branch-button\s*\{[\s\S]*?gap: 8px;[\s\S]*?animation: dmPop calc\(560ms \* var\(--mdur, 1\)\) var\(--spring-fast\) 240ms\s+backwards;/
    )
    assert.match(
      branchList,
      /className="new-branch-button"[\s\S]*?<Octicon symbol=\{octicons\.plus\} \/>/
    )
  })

  it('renders the no-pull-requests empty state as an illustrated blank slate', () => {
    assert.match(
      branchesStyle,
      /\.no-pull-requests\s*\{[\s\S]*?justify-content: center;[\s\S]*?text-align: center;[\s\S]*?padding: 40px;/
    )
    assert.match(
      branchesStyle,
      /\.no-pull-requests-icon\s*\{[\s\S]*?width: 66px;[\s\S]*?height: 66px;[\s\S]*?border-radius: 22px;[\s\S]*?background: var\(--md-sys-color-secondary-container\);[\s\S]*?animation: dmBounce/
    )
    assert.match(
      noPullRequests,
      /className="no-pull-requests-icon"[\s\S]*?<Octicon symbol=\{octicons\.gitMerge\} \/>/
    )
    assert.match(noPullRequests, /No open pull requests/)
  })

  it('styles the in-sheet search fields as 46px pills in both sheets', () => {
    // The pill treatment lives in the shared foldout scope covering both the
    // repository sheet and the branches sheet.
    assert.match(
      foldoutStyle,
      /&:has\(\.repository-list\),\s*&:has\(\.branches-container\) \{/
    )
    assert.match(
      foldoutStyle,
      /\.filter-list-filter-field\.text-box-component\s*\{[\s\S]*?height: 46px;[\s\S]*?border-radius: 999px;[\s\S]*?background: var\(--md-sys-color-surface-container-high\);/
    )
    assert.match(
      foldoutStyle,
      /\.prefixed-icon\s*\{[\s\S]*?position: static;[\s\S]*?color: var\(--md-sys-color-on-surface-variant\);/
    )
    // The input inside the pill is borderless and transparent.
    assert.match(
      foldoutStyle,
      /\.filter-list-filter-field\.text-box-component\s*\{[\s\S]*?input\s*\{[\s\S]*?border: 0;[\s\S]*?background: transparent;/
    )
  })
})
