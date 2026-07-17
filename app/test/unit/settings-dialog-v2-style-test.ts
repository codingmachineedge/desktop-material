import assert from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'fs'
import * as Path from 'path'

const app = Path.resolve(__dirname, '../..')

const styles = readFileSync(
  Path.join(app, 'styles/ui/_preferences.scss'),
  'utf8'
)
const appearance = readFileSync(
  Path.join(app, 'src/ui/preferences/appearance.tsx'),
  'utf8'
)

/** The prompts card block: from its selector up to the next top-level rule. */
const promptsBlock = styles.slice(
  styles.indexOf("[aria-labelledby='preferences-tab-prompts']"),
  styles.indexOf('.formatting-section')
)

describe('settings dialog v2 style contracts', () => {
  it('renders each Prompts row as a filled surface card, not a switch', () => {
    // Prompts must be split out of the shared 54x32 switch selector...
    assert.doesNotMatch(
      styles,
      /preferences-tab-prompts'\][^{]*\{[\s\S]{0,600}?width: 54px;/
    )
    assert.ok(promptsBlock.length > 0, 'prompts card block exists')
    assert.doesNotMatch(promptsBlock, /54px/)

    // ...and become filled surface cards with the prototype geometry.
    assert.match(
      promptsBlock,
      /\.checkbox-component\s*\{[\s\S]*?gap: 14px;[\s\S]*?padding: 13px 16px;[\s\S]*?border-radius: 16px;[\s\S]*?background: var\(--md-sys-color-surface\);/
    )
    assert.match(
      promptsBlock,
      /&:hover\s*\{\s*background: var\(--md-sys-color-surface-container-high\);/
    )
    assert.match(promptsBlock, /&:active\s*\{\s*transform: scale\(0\.985\);/)
    assert.match(
      promptsBlock,
      /animation: dmUp calc\(420ms \* var\(--mdur, 1\)\) var\(--spring\) backwards;/
    )
  })

  it('draws the prompt checkbox as a 20x20 M3 checkbox with a popping check', () => {
    assert.match(
      promptsBlock,
      /input\[type='checkbox'\]\s*\{[\s\S]*?width: 20px;[\s\S]*?height: 20px;[\s\S]*?border: 2px solid var\(--md-sys-color-outline\);[\s\S]*?border-radius: 7px;/
    )
    assert.match(
      promptsBlock,
      /&:checked\s*\{[\s\S]*?background: var\(--md-sys-color-primary\);[\s\S]*?border-color: var\(--md-sys-color-primary\);/
    )
    // The check pops in on the spring-fast curve like the prototype glyph.
    assert.match(
      promptsBlock,
      /transform: rotate\(-45deg\) scale\(0\);[\s\S]*?transition: transform 300ms var\(--spring-fast\), opacity 140ms;/
    )
    assert.match(promptsBlock, /transform: rotate\(-45deg\) scale\(1\);/)
  })

  it('styles the Appearance auto-fit control as a 54x32 toggle switch', () => {
    assert.match(
      styles,
      /\.tab-container\[aria-labelledby='preferences-tab-notifications'\]\s*\.checkbox-component,\s*\.tab-container\[aria-labelledby='preferences-tab-appearance'\]\s*\.checkbox-component\.auto-fit-zoom\s*\{[\s\S]*?flex-direction: row-reverse;[\s\S]*?width: 54px;[\s\S]*?height: 32px;[\s\S]*?border-radius: 999px;/
    )
    // Title-over-caption copy on the left of the switch.
    assert.match(
      styles,
      /\.auto-fit-zoom-title\s*\{[\s\S]*?font-weight: var\(--font-weight-semibold\);/
    )
    assert.match(
      styles,
      /\.auto-fit-zoom-caption\s*\{[\s\S]*?color: var\(--md-sys-color-on-surface-variant\);/
    )
    assert.match(appearance, /className="auto-fit-zoom-title"/)
    assert.match(appearance, /className="auto-fit-zoom-caption"/)
  })

  it('wraps the scale slider in a filled surface card with zoom glyphs', () => {
    assert.match(
      styles,
      /\.scaling-card\s*\{[\s\S]*?flex-direction: column;[\s\S]*?gap: 12px;[\s\S]*?padding: 16px 18px;[\s\S]*?border-radius: 18px;[\s\S]*?background: var\(--md-sys-color-surface\);/
    )
    assert.match(
      styles,
      /\.scaling-zoom-icon\s*\{[\s\S]*?color: var\(--md-sys-color-on-surface-variant\);/
    )
    assert.match(
      styles,
      /\.scaling-value\s*\{[\s\S]*?width: 52px;[\s\S]*?text-align: right;/
    )

    // The row markup: zoom-out and zoom-in octicons flanking the slider,
    // inside the card, with the readout at the end.
    assert.match(appearance, /className="scaling-card"/)
    assert.match(
      appearance,
      /scaling-zoom-out"[\s\S]{0,80}?symbol=\{octicons\.zoomOut\}[\s\S]*?className="scaling-slider"[\s\S]*?scaling-zoom-in"[\s\S]{0,80}?symbol=\{octicons\.zoomIn\}[\s\S]*?className="scaling-value"/
    )
    // The prototype card has no tick row under the slider.
    assert.doesNotMatch(appearance, /scaling-ticks/)
  })
})
