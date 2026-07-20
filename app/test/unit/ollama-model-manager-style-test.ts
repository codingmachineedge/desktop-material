import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_ollama-model-manager.scss'),
  'utf8'
)
const styleIndex = readFileSync(
  join(process.cwd(), 'app', 'styles', '_ui.scss'),
  'utf8'
)

describe('Ollama model manager style contracts', () => {
  it('is imported and bounds every two-pane surface', () => {
    assert.match(styleIndex, /@import 'ui\/ollama-model-manager';/)
    assert.match(
      styles,
      /\.ollama-model-manager\s*\{[\s\S]*container: ollama-model-manager \/ inline-size;[\s\S]*max-width: 100%;[\s\S]*overflow-x: hidden;/
    )
    assert.match(
      styles,
      /\.ollama-model-manager-workspace\s*\{[\s\S]*grid-template-columns: minmax\(210px, 0\.8fr\) minmax\(280px, 1\.2fr\);/
    )
    assert.match(styles, /\.ollama-model-list\s*\{[\s\S]*overflow-y: auto;/)
  })

  it('collapses at both compact container breakpoints', () => {
    assert.match(
      styles,
      /@container ollama-model-manager \(max-width: 700px\)[\s\S]*\.ollama-model-manager-workspace[\s\S]*grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      styles,
      /@container ollama-model-manager \(max-width: 460px\)[\s\S]*\.ollama-model-editors,[\s\S]*\.ollama-inventory-controls[\s\S]*grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      styles,
      /@media \(max-width: 700px\)[\s\S]*\.ollama-model-manager-workspace[\s\S]*grid-template-columns: minmax\(0, 1fr\);/
    )
  })

  it('keeps focus indicators visible and disables indeterminate motion when requested', () => {
    assert.match(styles, /&:focus-visible\s*\{[\s\S]*box-shadow:/)
    assert.match(
      styles,
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*progress:indeterminate[\s\S]*animation: none;/
    )
  })
})
