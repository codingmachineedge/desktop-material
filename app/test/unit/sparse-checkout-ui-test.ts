import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (...parts: string[]) =>
  readFileSync(join(process.cwd(), ...parts), 'utf8')

const component = read(
  'app',
  'src',
  'ui',
  'sparse-checkout',
  'sparse-checkout.tsx'
)
const styles = read('app', 'styles', 'ui', '_sparse-checkout.scss')
const gitHelper = read('app', 'src', 'lib', 'git', 'sparse-checkout.ts')
const menu = read('app', 'src', 'main-process', 'menu', 'build-default-menu.ts')
const app = read('app', 'src', 'ui', 'app.tsx')
const popup = read('app', 'src', 'models', 'popup.ts')

describe('Sparse checkout native UI contracts', () => {
  it('opens a typed non-modal repository sheet from the native menu', () => {
    assert.match(menu, /id: 'manage-sparse-checkout'/)
    assert.match(menu, /emit\('manage-sparse-checkout'\)/)
    assert.match(app, /case 'manage-sparse-checkout'/)
    assert.match(app, /PopupType\.SparseCheckout/)
    assert.match(app, /<SparseCheckoutManager/)
    assert.match(
      popup,
      /nonModalHistoryPopupTypes[\s\S]*PopupType\.SparseCheckout/
    )
  })

  it('requires explicit review, cancels the exact request, and refreshes', () => {
    assert.match(component, /role="alertdialog"/)
    assert.match(component, /Files may disappear locally or[\s\S]*commits/)
    assert.match(component, /this\.mutationController\.abort\(\)/)
    assert.match(component, /await this\.props\.onRefreshRepository\(\)/)
    assert.match(component, /this\.cancelButton\?\.focus\(\)/)
    assert.match(component, /onFocusCapture=\{this\.onRequestFront\}/)
    assert.match(component, /aria-label="Included directories"/)
    assert.match(component, /aria-invalid=/)
    assert.match(component, /disabled=\{this\.state\.busy \|\| reviewing\}/)
    assert.match(component, /Review directory update/)
    assert.match(component, /Review reapply/)
    assert.match(component, /Review disable/)
  })

  it('keeps all commands shell-free with fixed argv and stdin patterns', () => {
    assert.match(gitHelper, /\['sparse-checkout', 'set', '--cone', '--stdin'\]/)
    assert.match(gitHelper, /\['sparse-checkout', 'reapply'\]/)
    assert.match(gitHelper, /\['sparse-checkout', 'disable'\]/)
    assert.match(gitHelper, /stdin,[\s\S]*processCallback:/)
    assert.doesNotMatch(gitHelper, /shell\s*:/)
  })

  it('contains horizontal overflow and stacks at compact and short sizes', () => {
    assert.match(styles, /\.sparse-checkout-panel[\s\S]*overflow: hidden/)
    assert.match(styles, /\.sparse-checkout-content[\s\S]*overflow-x: hidden/)
    assert.match(
      styles,
      /\.sparse-checkout-editor[\s\S]*overflow: auto[\s\S]*white-space: pre/
    )
    assert.match(
      styles,
      /@container sparse-checkout-panel \(max-width: 620px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/
    )
    assert.match(styles, /@media \(max-height: 560px\)/)
    assert.match(styles, /overflow-wrap: anywhere/)
  })
})
