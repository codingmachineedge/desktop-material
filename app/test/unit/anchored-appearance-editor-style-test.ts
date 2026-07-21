import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const style = readFileSync(
  join(
    process.cwd(),
    'app',
    'styles',
    'ui',
    '_anchored-appearance-editor.scss'
  ),
  'utf8'
)
const uiIndex = readFileSync(
  join(process.cwd(), 'app', 'styles', '_ui.scss'),
  'utf8'
)

describe('anchored appearance editor styles', () => {
  it('bounds the editor to the popover space and keeps both axes reachable', () => {
    assert.match(
      style,
      /\.anchored-appearance-editor\s*\{[\s\S]*?--anchored-appearance-editor-preferred-width: 390px;[\s\S]*?width: min\([\s\S]*?var\(--anchored-appearance-editor-preferred-width\),[\s\S]*?calc\(var\(--available-width, 100vw\) - 32px\)[\s\S]*?\);[\s\S]*?max-height: min\(620px, calc\(var\(--available-height, 100vh\) - 32px\)\);[\s\S]*?overflow: hidden;/
    )
    assert.match(
      style,
      /\.anchored-appearance-editor:has\(\.element-appearance-editor-wide\)\s*\{[\s\S]*?--anchored-appearance-editor-preferred-width: 780px;/
    )
    assert.match(
      style,
      /\.anchored-appearance-editor-content\s*\{[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;/
    )
  })

  it('has narrow and short viewport fallbacks plus reduced motion', () => {
    assert.match(
      style,
      /@media \(max-width: 440px\), \(max-height: 500px\)[\s\S]*?\.anchored-appearance-editor\s*\{[\s\S]*?width: min\(390px, calc\(var\(--available-width, 100vw\) - 20px\)\);/
    )
    assert.match(
      style,
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.anchored-appearance-editor,[\s\S]*?\.appearance-element-history-dialog[\s\S]*?animation: none;/
    )
    assert.match(uiIndex, /@import 'ui\/anchored-appearance-editor';/)
  })
})
