import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const style = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_repository-tabs.scss'),
  'utf8'
)
const strip = readFileSync(
  join(
    process.cwd(),
    'app',
    'src',
    'ui',
    'repository-tabs',
    'repository-tab-strip.tsx'
  ),
  'utf8'
)

describe('repository tab action responsive styles', () => {
  it('adds inverse close without removing the existing close-matching action', () => {
    assert.match(strip, /label: 'Close Tabs Containing…'/)
    assert.match(strip, /label: 'Close All Tabs Except Those Containing…'/)
  })

  it('keeps favorite tabs visible, labelled, and independently sortable', () => {
    assert.match(strip, /Add to Favorites/)
    assert.match(strip, /setTabFavorite/)
    assert.match(style, /\.repository-tab-favorite\s*\{[\s\S]*?focus-visible/)
    assert.match(style, /&\.favorite \.repository-tab-favorite/)
  })

  it('bounds both Material action surfaces without horizontal clipping', () => {
    assert.match(
      style,
      /\.close-tabs-containing\s*\{[\s\S]*?min-width: 0;[\s\S]*?max-width: calc\(100vw - 52px\);[\s\S]*?max-height: min\([\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      style,
      /\.close-tabs-except\s*\{[\s\S]*?min-width: 0;[\s\S]*?max-width: calc\(100vw - 52px\);[\s\S]*?max-height: min\([\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      style,
      /\.arrange-tabs\s*\{[\s\S]*?min-width: 0;[\s\S]*?max-width: calc\(100vw - 52px\);[\s\S]*?max-height: min\([\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      style,
      /\.tab-search-popover\s*\{[\s\S]*?min-width: 0;[\s\S]*?max-width: calc\(100vw - 52px\);[\s\S]*?max-height: min\([\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      style,
      /\.tab-search-results\s*\{[\s\S]*?max-height: 350px;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      style,
      /\.popover-component:has\(\.close-tabs-except\),[\s\S]*?max-width: calc\(100vw - 20px\);[\s\S]*?max-height: var\(--available-height,[\s\S]*?overflow: hidden;/
    )
  })

  it('stacks arrange content and keeps sticky actions reachable when compact', () => {
    assert.match(
      style,
      /\.close-tabs-except-actions\s*\{[\s\S]*?position: sticky;[\s\S]*?flex-wrap: wrap;/
    )
    assert.match(style, /\.arrange-tabs-actions\s*\{[\s\S]*?position: sticky;/)
    assert.match(
      style,
      /@media \(max-width: 520px\), \(max-height: 560px\)[\s\S]*?\.arrange-tabs-row\s*\{[\s\S]*?flex-direction: column;[\s\S]*?\.arrange-tabs-sort-grid\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      style,
      /\.arrange-tabs-filter\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/
    )
    assert.match(
      style,
      /@media \(max-width: 520px\), \(max-height: 560px\)[\s\S]*?\.tab-search-popover \.tab-search-results\s*\{[\s\S]*?max-height: 220px;/
    )
  })

  it('provides visible keyboard focus on tabs and action controls', () => {
    assert.match(
      style,
      /\.repository-tab\s*\{[\s\S]*?&:focus-visible\s*\{[\s\S]*?outline: 2px solid/
    )
    assert.match(
      style,
      /\.arrange-tabs[\s\S]*?button:focus-visible\s*\{[\s\S]*?outline: 2px solid/
    )
  })
})
