import assert from 'node:assert'
import { describe, it } from 'node:test'
import { readFile } from 'fs/promises'
import * as Path from 'path'

const app = Path.resolve(__dirname, '../..')

describe('repository logo studio style contract', () => {
  it('owns a bounded internal scroll region at regular and compact heights', async () => {
    const styles = await readFile(
      Path.join(app, 'styles/ui/_repository-logo.scss'),
      'utf8'
    )
    assert.match(
      styles,
      /\.repository-logo-editor-scroll\s*\{[\s\S]*?max-height: min\(620px, calc\(100vh - 260px\)\);[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;[\s\S]*?overscroll-behavior: contain;/
    )
    assert.match(
      styles,
      /@media \(max-height: 650px\)[\s\S]*?max-height: max\(180px, calc\(100vh - 230px\)\);/
    )
  })

  it('collapses the workbench and keeps controls width-bounded', async () => {
    const styles = await readFile(
      Path.join(app, 'styles/ui/_repository-logo.scss'),
      'utf8'
    )
    assert.match(
      styles,
      /&,[\s\S]*?\* \{[\s\S]*?box-sizing: border-box;[\s\S]*?min-width: 0;/
    )
    assert.match(
      styles,
      /@container repository-settings-pane \(max-width: 620px\)[\s\S]*?\.repository-logo-workbench \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      styles,
      /@container preferences-pane \(max-width: 620px\)[\s\S]*?\.repository-logo-workbench \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      styles,
      /\.repository-logo-control-grid,[\s\S]*?grid-template-columns: repeat\(auto-fit, minmax\(132px, 1fr\)\);/
    )
  })

  it('imports the owned logo styles without modifying global dialog rules', async () => {
    const index = await readFile(Path.join(app, 'styles/_ui.scss'), 'utf8')
    assert.match(index, /@import 'ui\/repository-logo';/)
  })
})
