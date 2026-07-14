import assert from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_notification-centre.scss'),
  'utf8'
)

describe('GitHub notification responsive styles', () => {
  it('contains the panel and every flexible GitHub region horizontally', () => {
    assert.match(
      styles,
      /\.notification-centre-panel\s*\{[\s\S]*?max-width: calc\(100vw - 20px\);[\s\S]*?overflow(?:-x)?: hidden;/
    )
    assert.match(
      styles,
      /\.notification-centre-source-panel\s*\{[\s\S]*?min-width: 0;[\s\S]*?overflow-x: hidden;/
    )
    assert.match(
      styles,
      /\.github-notifications-toolbar\s*\{[\s\S]*?min-width: 0;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;/
    )
    assert.match(
      styles,
      /\.github-notifications-account[\s\S]*?select\s*\{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;/
    )
  })

  it('wraps long titles, metadata, errors, and confirmation copy', () => {
    assert.match(
      styles,
      /\.notification-centre-header\s*\{[\s\S]*?flex-wrap: wrap;/
    )
    assert.match(
      styles,
      /\.notification-item-title\s*\{[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      styles,
      /\.github-notification-meta\s*\{[\s\S]*?flex-wrap: wrap;[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      styles,
      /\.github-notifications-error[\s\S]*?grid-template-columns: auto minmax\(0, 1fr\);[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      styles,
      /\.github-notification-done-confirmation\s*\{[\s\S]*?overflow-wrap: anywhere;/
    )
  })

  it('stacks the toolbar and wraps notification actions on narrow windows', () => {
    assert.match(styles, /@media \(max-width: 420px\)/)
    assert.match(
      styles,
      /@media \(max-width: 420px\)[\s\S]*?\.github-notifications-toolbar\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      styles,
      /@media \(max-width: 420px\)[\s\S]*?\.notification-item\s*\{[\s\S]*?flex-wrap: wrap;/
    )
  })
})
