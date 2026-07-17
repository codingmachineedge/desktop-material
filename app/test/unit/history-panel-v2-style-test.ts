import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const read = (...parts: ReadonlyArray<string>) =>
  readFileSync(join(process.cwd(), 'app', ...parts), 'utf8')

const compare = read('src', 'ui', 'history', 'compare.tsx')
const commitListItem = read('src', 'ui', 'history', 'commit-list-item.tsx')
const commitList = read('src', 'ui', 'history', 'commit-list.tsx')
const ecs = read('src', 'ui', 'history', 'expandable-commit-summary.tsx')
const historyStyle = read('styles', 'ui', 'history', '_history.scss')
const commitListStyle = read('styles', 'ui', 'history', '_commit-list.scss')
const ecsStyle = read(
  'styles',
  'ui',
  'history',
  '_expandable-commit-summary.scss'
)

describe('history panel v2: sidebar title header', () => {
  it('renders an H1 History title with a formatted count pill', () => {
    assert.match(
      compare,
      /<div className="history-panel-header">[\s\S]*?<h1 className="history-panel-title">History<\/h1>[\s\S]*?history-panel-count[\s\S]*?\{formatNumber\(commitCount\)\}/
    )
  })

  it('styles the title at 21px/600 with the prototype header inset', () => {
    assert.match(
      historyStyle,
      /\.history-panel-header\s*\{[\s\S]*?padding: 18px 18px 10px;[\s\S]*?\.history-panel-title\s*\{[\s\S]*?font-size: 21px;[\s\S]*?font-weight: 600;[\s\S]*?letter-spacing: -0\.01em;/
    )
  })

  it('renders the count as a 24px radius-999 tonal pill', () => {
    assert.match(
      historyStyle,
      /\.history-panel-count\s*\{[\s\S]*?height: 24px;[\s\S]*?border-radius: 999px;[\s\S]*?background: var\(--md-sys-color-surface-container-high\);[\s\S]*?color: var\(--md-sys-color-on-surface-variant\);[\s\S]*?font-size: 12\.5px;[\s\S]*?font-weight: 700;/
    )
  })
})

describe('history panel v2: filter chip row', () => {
  it('keeps the FilterModeControl while hosting its own regex builder', () => {
    assert.match(compare, /<FilterModeControl[\s\S]*?showRegexBuilder=\{false\}/)
    assert.match(compare, /<RegexBuilder[\s\S]*?targetLabel="Commits"/)
  })

  it('mirrors the prototype Unpushed / Tagged / Mine predicate chips', () => {
    assert.match(compare, /label: 'Unpushed'/)
    assert.match(compare, /label: 'Tagged'/)
    assert.match(compare, /label: 'Mine'/)
    assert.match(
      compare,
      /className=\{classNames\('history-filter-chip', \{ active: chip\.on \}\)\}/
    )
  })

  it('routes per-chip toggles through a data attribute, not inline closures', () => {
    assert.match(compare, /data-chip-id=\{chip\.id\}/)
    assert.match(compare, /onClick=\{this\.onCommitFilterChipToggle\}/)
    assert.match(compare, /event\.currentTarget\.dataset\.chipId/)
  })

  it('renders a trailing Regex builder launcher chip', () => {
    assert.match(
      compare,
      /className="history-regex-builder-chip"[\s\S]*?aria-label="Open regex builder"[\s\S]*?<span className="chip-glyph">\.\*<\/span>/
    )
  })

  it('styles chips as 30px radius-999 tonal-selectable pills', () => {
    assert.match(
      historyStyle,
      /\.history-filter-chip,\s*\.history-regex-builder-chip\s*\{[\s\S]*?height: 30px;[\s\S]*?padding: 0 12px;[\s\S]*?border-radius: 999px;[\s\S]*?font-size: 12px;[\s\S]*?font-weight: 700;/
    )
    assert.match(
      historyStyle,
      /\.history-filter-chip\s*\{[\s\S]*?&\.active\s*\{[\s\S]*?background: var\(--md-sys-color-secondary-container\);[\s\S]*?color: var\(--md-sys-color-on-secondary-container\);/
    )
  })

  it('animates the row with dmUp and the active check with dmPop', () => {
    assert.match(
      historyStyle,
      /\.history-filter-chips\s*\{[\s\S]*?animation: dmUp calc\(340ms \* var\(--mdur\)\) var\(--spring\) backwards;/
    )
    assert.match(
      historyStyle,
      /\.chip-check\s*\{[\s\S]*?animation: dmPop calc\(300ms \* var\(--mdur\)\) var\(--spring-fast\) backwards;/
    )
  })

  it('paints the regex-builder chip on primary-container', () => {
    assert.match(
      historyStyle,
      /\.history-regex-builder-chip\s*\{[\s\S]*?background: var\(--md-sys-color-primary-container\);[\s\S]*?color: var\(--md-sys-color-on-primary-container\);/
    )
  })

  it('restyles the tune toggle as a 32px radius-10 secondary-container button', () => {
    assert.match(
      historyStyle,
      /\.history-filter-chips-toggle\.button-component\s*\{[\s\S]*?width: 32px;[\s\S]*?height: 32px;[\s\S]*?border-radius: 10px;[\s\S]*?&\.active,\s*&\[aria-expanded='true'\]\s*\{[\s\S]*?background: var\(--md-sys-color-secondary-container\);/
    )
  })
})

describe('history panel v2: commit row avatar disc', () => {
  it('leads each row with a 34px Avatar disc instead of a byline stack', () => {
    assert.match(
      commitListItem,
      /<div className="commit-avatar">[\s\S]*?<Avatar[\s\S]*?size=\{34\}/
    )
    assert.doesNotMatch(commitListItem, /AvatarStack/)
  })

  it('sizes rows for the 34px disc (11px inset -> 56px rows)', () => {
    assert.match(commitList, /const RowHeight = 56/)
    assert.match(
      commitListStyle,
      /#commit-drag-element \.commit,\s*#commit-list \.commit\s*\{\s*padding: 11px 12px;/
    )
  })

  it('styles the disc as a radius-999 primary-container circle', () => {
    assert.match(
      commitListStyle,
      /\.commit-avatar\s*\{[\s\S]*?width: 34px;[\s\S]*?height: 34px;[\s\S]*?border-radius: 999px;[\s\S]*?background: var\(--md-sys-color-primary-container\);/
    )
  })

  it('springs the disc to 1.1 on row hover', () => {
    assert.match(
      commitListStyle,
      /\.commit-avatar\s*\{[\s\S]*?transition: transform 220ms var\(--spring-fast\);/
    )
    assert.match(
      commitListStyle,
      /&:hover \.commit-avatar\s*\{\s*transform: scale\(1\.1\);/
    )
  })
})

describe('commit detail v2: header author avatar', () => {
  it('renders a leading 42px Avatar inside the header row', () => {
    assert.match(
      ecs,
      /<div className="ecs-header-avatar">[\s\S]*?<Avatar accounts=\{accounts\} user=\{user\} size=\{42\} \/>/
    )
    assert.match(
      ecs,
      /<div className="ecs-header">[\s\S]*?\{this\.renderHeaderAvatar\(\)\}[\s\S]*?<div className="ecs-header-content">[\s\S]*?\{this\.renderSummary\(\)\}/
    )
  })

  it('drops the redundant collapsed byline avatar stack', () => {
    assert.doesNotMatch(ecs, /AvatarStack/)
  })

  it('styles the header avatar as a 42px dmPop primary-container disc', () => {
    assert.match(
      ecsStyle,
      /\.ecs-header-avatar\s*\{[\s\S]*?width: 42px;[\s\S]*?height: 42px;[\s\S]*?border-radius: 999px;[\s\S]*?animation: dmPop calc\(480ms \* var\(--mdur\)\) var\(--spring-fast\) backwards;/
    )
  })

  it('lays the header out per prototype (18/18/14 inset, 12px gap)', () => {
    assert.match(
      ecsStyle,
      /\.ecs-header\s*\{[\s\S]*?display: flex;[\s\S]*?align-items: flex-start;[\s\S]*?gap: 12px;[\s\S]*?padding: 18px 18px 14px;/
    )
  })
})
