import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const readStyle = (name: string) =>
  readFileSync(join(process.cwd(), 'app', 'styles', 'ui', name), 'utf8')

describe('compact settings style contracts', () => {
  it('keeps Preferences recoverable from a narrow pane without sideways scrolling', () => {
    const style = readStyle('_preferences.scss')

    assert.match(style, /container-name: preferences-dialog;/)
    assert.match(style, /container-name: preferences-pane;/)
    assert.match(
      style,
      /@container preferences-dialog \(max-width: 620px\)[\s\S]*?\.preferences-rail\s*\{[\s\S]*?width: 72px;/
    )
    assert.match(
      style,
      /@container preferences-pane \(max-width: 520px\)[\s\S]*?\.provider-sign-in-card\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      style,
      /\.dialog-footer\s*\{[\s\S]*?\.button-group\s*\{[\s\S]*?flex-wrap: wrap;/
    )
  })

  it('turns Repository Settings into compact navigation and stacked cards', () => {
    const style = readStyle('dialogs/_repository-settings.scss')

    assert.match(style, /container-name: repository-settings-dialog;/)
    assert.match(style, /container-name: repository-settings-pane;/)
    assert.match(style, /overflow-x: hidden;/)
    assert.match(
      style,
      /@container repository-settings-dialog \(max-width: 520px\)[\s\S]*?grid-template-columns: repeat\(auto-fit, minmax\(40px, 1fr\)\);/
    )
    assert.match(
      style,
      /@container repository-settings-pane \(max-width: 500px\)[\s\S]*?\.remote-row\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 40px;/
    )
    assert.match(
      style,
      /\.submodule-row\s*\{[\s\S]*?flex-direction: column;/
    )
  })
})
