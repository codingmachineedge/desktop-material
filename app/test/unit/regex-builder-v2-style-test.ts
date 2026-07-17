import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

const styles = read('app/styles/ui/_regex-builder.scss')
const builder = read('app/src/ui/lib/regex-builder/regex-builder.tsx')
const guide = read('app/src/ui/lib/regex-builder/regex-builder-guide.tsx')

describe('Regex builder v2 style contract', () => {
  it('keeps a 50px margin between the dialog and the viewport edges', () => {
    assert.match(
      styles,
      /\.regex-builder-dialog\s*\{[\s\S]*?width: min\(900px, calc\(100vw - 50px\)\);/
    )
    assert.match(
      styles,
      /\.regex-builder-dialog\s*\{[\s\S]*?height: min\(644px, calc\(100vh - 50px\)\);/
    )
    assert.match(
      styles,
      /\.regex-builder-dialog\s*\{[\s\S]*?max-width: calc\(100vw - 50px\);[\s\S]*?max-height: calc\(100vh - 50px\);/
    )
  })

  it('renders the Build / How regex works segmented tab row', () => {
    // Prototype: full-width pill tabs, 38px tall, selected tab filled with
    // the secondary container pair.
    assert.match(
      styles,
      /\.regex-builder-views\s*\{[\s\S]*?flex: none;[\s\S]*?display: flex;[\s\S]*?gap: 6px;/
    )
    assert.match(
      styles,
      /\.regex-builder-view-tab\s*\{[\s\S]*?flex: 1;[\s\S]*?height: 38px;[\s\S]*?border-radius: 999px;/
    )
    assert.match(
      styles,
      /\.regex-builder-view-tab\s*\{[\s\S]*?&\.selected\s*\{\s*background: var\(--md-sys-color-secondary-container\);\s*color: var\(--md-sys-color-on-secondary-container\);/
    )

    // The component wires the two tabs up as an accessible tablist.
    assert.match(
      builder,
      /role="tablist"[\s\S]*?aria-label="Regex builder views"/
    )
    assert.match(builder, /aria-selected=\{selected\}/)
    assert.match(builder, /label="Build"[\s\S]*?icon=\{octicons\.tools\}/)
    assert.match(
      builder,
      /label="How regex works"[\s\S]*?icon=\{octicons\.book\}/
    )
    // Bound class-field handler — no inline arrows in JSX props.
    assert.match(builder, /private onSelectView = \(view: RegexBuilderView\)/)
    assert.match(
      builder,
      /\{this\.state\.view === 'build' \? \([\s\S]*?this\.renderBuildView\(\)[\s\S]*?\) : \([\s\S]*?<RegexBuilderGuide \/>/
    )
  })

  it('ships the full scrollable guide panel as the alternate view', () => {
    assert.match(
      styles,
      /\.regex-builder-guide\s*\{[\s\S]*?flex: 1;[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;[\s\S]*?border-top: 1px solid var\(--md-sys-color-outline-variant\);/
    )
    assert.match(
      styles,
      /\.regex-guide-section\s*\{[\s\S]*?animation: dmUp calc\(420ms \* var\(--mdur, 1\)\) var\(--spring\) backwards;/
    )
    assert.match(
      styles,
      /\.regex-guide-code\s*\{[\s\S]*?background: var\(--md-sys-color-surface\);/
    )
    assert.match(
      styles,
      /\.regex-guide-code-token\s*\{\s*color: var\(--md-sys-color-primary\);\s*font-weight: 700;/
    )

    assert.match(
      guide,
      /role="tabpanel"[\s\S]*?aria-labelledby="regex-builder-view-tab-guide"/
    )
    // The staggered entrance mirrors the prototype's 50ms/450ms cadence.
    assert.match(guide, /Math\.min\(index \* StaggerStepMs, MaxStaggerMs\)/)

    // All nine prototype rbGuide sections, in order.
    const titles = [
      'How matching works',
      'Anchors pin the position',
      'Character classes',
      'Quantifiers and greediness',
      'Groups and backreferences',
      'Alternation',
      'Lookaround',
      'Flags change the rules',
      'How Desktop Material uses regex',
    ]
    let cursor = 0
    for (const title of titles) {
      const at = guide.indexOf(`title: '${title}'`, cursor)
      assert.ok(at >= 0, `guide section "${title}" present and in order`)
      cursor = at
    }

    // A representative sample of the teaching examples survived extraction.
    assert.ok(guide.includes('^app/.*\\\\.scss$'))
    assert.ok(guide.includes('[0-9a-f]{7}'))
    assert.ok(guide.includes('(\\\\w+)-\\\\1'))
    assert.ok(guide.includes('ui/(?!lib)'))
  })

  it('uses design tokens only — no literal colors', () => {
    assert.doesNotMatch(styles, /#[0-9a-fA-F]{3,8}\b/)
    assert.doesNotMatch(styles, /\brgba?\(/)
  })

  it('avoids title attributes on the new controls', () => {
    assert.doesNotMatch(builder, /\btitle=/)
    assert.doesNotMatch(guide, /\btitle=/)
  })
})
