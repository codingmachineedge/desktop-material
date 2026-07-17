import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'

const sass = createRequire(__filename)('sass') as {
  readonly renderSync: (options: { readonly data: string }) => {
    readonly css: Buffer
  }
}

const styles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_repository-tools.scss'),
  'utf8'
)
const materialCardStyles = readFileSync(
  join(process.cwd(), 'app', 'styles', 'ui', '_material-cards.scss'),
  'utf8'
)

describe('Repository tools responsive styles', () => {
  it('wraps long labels and result output without horizontal clipping', () => {
    assert.match(styles, /\.repository-tools[\s\S]*overflow-x: hidden/)
    assert.match(styles, /\.repository-tool-card[\s\S]*overflow-wrap: anywhere/)
    assert.match(
      styles,
      /\.repository-tools-output[\s\S]*white-space: pre-wrap/
    )
    assert.match(styles, /\.repository-tools-output[\s\S]*overflow-x: hidden/)
  })

  it('overrides the Material card frame with an owned vertical scroll region', () => {
    assert.match(
      styles,
      /#repository\s*>\s*\.repository-tools:not\(\.repository-rail\):not\(\.focus-container\):not\([\s\S]*?\.tutorial-panel-component[\s\S]*?\)\s*\{[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;[\s\S]*?scrollbar-gutter: stable;/
    )
  })

  it('wins the compiled cascade instead of being clipped by the card frame', () => {
    const style = document.createElement('style')
    // eslint-disable-next-line no-sync
    style.textContent = sass
      .renderSync({ data: `${materialCardStyles}\n${styles}` })
      .css.toString()
    document.head.append(style)

    const repository = document.createElement('div')
    repository.id = 'repository'
    const tools = document.createElement('main')
    tools.className = 'repository-tools'
    repository.append(tools)
    document.body.append(repository)

    const computed = window.getComputedStyle(tools)
    assert.equal(computed.overflowX, 'hidden')
    assert.equal(computed.overflowY, 'auto')

    repository.remove()
    style.remove()
  })

  it('stacks results and controls at compact and zoomed widths', () => {
    assert.match(styles, /@media \(max-width: 1120px\)/)
    assert.match(
      styles,
      /@media \(max-width: 1120px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/
    )
    assert.match(styles, /@media \(max-width: 700px\)/)
    assert.match(styles, /flex-direction: column/)
    assert.match(
      styles,
      /\.repository-tool-card\s*\{[\s\S]*?\.button-component\s*\{[\s\S]*?max-width: 100%/
    )
    assert.match(
      styles,
      /\.repository-tool-confirmation[\s\S]*overflow-wrap: anywhere/
    )
  })
})
