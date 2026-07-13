import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('compact shell style contracts', () => {
  it('keeps the low-height repository rail vertically reachable', () => {
    const style = read('app/styles/ui/_material-rail.scss')

    assert.match(
      style,
      /\.repository-rail\s*\{[\s\S]*?min-height: 0;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(style, /@media \(max-height: 520px\)/)
    assert.match(
      style,
      /\.tab-bar\.vertical \.tab-bar-item,[\s\S]*?min-height: 40px;/
    )
    assert.match(
      style,
      /\.rail-label\s*\{[\s\S]*?clip-path: inset\(50%\);[\s\S]*?white-space: nowrap;/
    )
  })

  it('preserves whole app-bar hit targets and accessible clipped labels', () => {
    const style = read('app/styles/_material-shell.scss')
    const component = read('app/src/ui/toolbar/button.tsx')

    assert.match(
      style,
      /@media \(max-width: 760px\), \(max-height: 420px\)/
    )
    assert.match(
      style,
      /\.toolbar-button\s*\{[\s\S]*?width: 48px !important;[\s\S]*?min-width: 40px !important;/
    )
    assert.match(
      style,
      /& > \.sidebar-section,[\s\S]*?& > \.resizable-component\s*\{[\s\S]*?flex: 0 1 auto;/
    )
    assert.match(
      style,
      /> button\s*\{[\s\S]*?min-height: 40px;[\s\S]*?\.text\s*\{[\s\S]*?clip-path: inset\(50%\);/
    )
    assert.match(style, /@media \(max-width: 440px\)/)
    assert.match(style, /flex-wrap: wrap;/)
    assert.match(component, /\{this\.renderText\(\)\}/)
  })
})
