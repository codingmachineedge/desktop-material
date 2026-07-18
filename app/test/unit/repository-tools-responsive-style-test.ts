import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const readStyle = (name: string) =>
  readFileSync(join(process.cwd(), 'app', 'styles', 'ui', name), 'utf8')

describe('repository tools hub responsive contracts', () => {
  const tools = readStyle('_repository-tools.scss')

  it('keeps every hub descendant border-boxed and shrinkable', () => {
    assert.match(
      tools,
      /\.repository-tools-modal \*,[\s\S]*?box-sizing: border-box;\s*min-width: 0;/
    )
  })

  it('owns the vertical scroll through the pane scrollport and capped card', () => {
    assert.match(
      tools,
      /\.repository-tools \{[\s\S]*?flex: 1;[\s\S]*?min-height: 0;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      tools,
      /\.repository-tools-modal \{[\s\S]*?flex-direction: column;[\s\S]*?height: 700px;[\s\S]*?max-height: 100%;[\s\S]*?overflow: hidden;/
    )
    assert.match(
      tools,
      /\.repository-tools-functions \{[\s\S]*?flex: 1;[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      tools,
      /\.repository-tools-results-column \{[\s\S]*?min-height: 0;[\s\S]*?min-width: 0;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
  })

  it('lets the fixed sidebar rail shrink instead of clipping narrow panes', () => {
    assert.match(
      tools,
      /\.repository-tools-sidebar \{[\s\S]*?flex: 0 1 auto;[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;[\s\S]*?width: 300px;/
    )
  })

  it('lets chips and the search pill grow instead of clipping wrapped text', () => {
    assert.match(
      tools,
      /\.repository-tools-search \{[\s\S]*?height: auto;[\s\S]*?max-width: 100%;[\s\S]*?min-height: 44px;/
    )
    assert.match(
      tools,
      /\.repository-tools-filter-chip \{[\s\S]*?height: auto;[\s\S]*?max-width: 100%;[\s\S]*?min-height: 30px;[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      tools,
      /\.repository-tools-detail-chip \{[\s\S]*?height: auto;[\s\S]*?max-width: 100%;[\s\S]*?min-height: 26px;[\s\S]*?overflow-wrap: anywhere;/
    )
  })

  it('keeps hub grids collapsible below their preferred track sizes', () => {
    assert.match(
      tools,
      /\.repository-tools-card-grid \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      tools,
      /\.repository-commit-rewrite-row-controls \{[\s\S]*?grid-template-columns: minmax\(min\(100%, 190px\), 1fr\) auto auto;/
    )
  })

  it('stacks the layout at narrow widths and relaxes the card height', () => {
    assert.match(
      tools,
      /@media \(max-width: 1120px\) \{[\s\S]*?\.repository-tools-layout \{[\s\S]*?flex-direction: column;/
    )
    assert.match(
      tools,
      /@media \(max-width: 700px\) \{[\s\S]*?\.repository-tools-modal \{[\s\S]*?height: auto;[\s\S]*?max-height: 100%;/
    )
  })

  it('hands compact heights to the outer scrollport instead of clipping', () => {
    assert.match(
      tools,
      /@media \(max-height: 320px\) \{[\s\S]*?\.repository-tools-output \{[\s\S]*?height: 48px;[\s\S]*?max-height: 48px;/
    )
    assert.match(
      tools,
      /@media \(max-height: 320px\) \{[\s\S]*?\.repository-tools-modal \{[\s\S]*?height: auto;[\s\S]*?max-height: none;[\s\S]*?\.repository-tools-functions \{[\s\S]*?flex: none;[\s\S]*?max-height: 96px;/
    )
  })
})
