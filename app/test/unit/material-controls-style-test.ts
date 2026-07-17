import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (...parts: ReadonlyArray<string>) =>
  readFileSync(join(process.cwd(), ...parts), 'utf8')

/**
 * Contract for the Desktop Material v2 control layer: every browser-native
 * control is materialized as Material Design 3 from --md-sys-* tokens, and the
 * layer loads last so it wins. Keeps the app 1:1 with the design prototype.
 */
describe('Material Design 3 control layer', () => {
  it('loads the control layer last, after the Material shell', () => {
    const desktop = read('app', 'styles', 'desktop.scss')
    assert.match(
      desktop,
      /@import 'material-shell';\s*@import 'material-controls';/
    )
    // Nothing may load after it.
    assert.match(desktop, /@import 'material-controls';\s*$/)
  })

  it('materializes checkboxes as M3 (filled primary, masked check, dash)', () => {
    const css = read('app', 'styles', '_material-controls.scss')
    assert.match(
      css,
      /input\[type='checkbox'\]\s*\{[\s\S]*?appearance: none;[\s\S]*?border: 2px solid var\(--md-sys-color-on-surface-variant\);/
    )
    assert.match(
      css,
      /&:checked,\s*&:indeterminate\s*\{\s*background: var\(--md-sys-color-primary\);/
    )
    // The tick and dash are alpha masks tinted by the on-primary background.
    assert.match(css, /background: var\(--md-sys-color-on-primary\);/)
    assert.match(css, /-webkit-mask: url\("data:image\/svg\+xml/)
    assert.match(css, /d='M6 12h12'/) // indeterminate dash
  })

  it('materializes radios as an M3 ring with an animated primary dot', () => {
    const css = read('app', 'styles', '_material-controls.scss')
    assert.match(
      css,
      /input\[type='radio'\]\s*\{[\s\S]*?appearance: none;[\s\S]*?border-radius: 50%;/
    )
    assert.match(
      css,
      /&::after\s*\{[\s\S]*?background: var\(--md-sys-color-primary\);\s*transform: scale\(0\);/
    )
    assert.match(
      css,
      /&:checked\s*\{[\s\S]*?&::after\s*\{\s*transform: scale\(1\);/
    )
  })

  it('materializes range sliders as the M3 Expressive bar-handle slider', () => {
    const css = read('app', 'styles', '_material-controls.scss')
    assert.match(
      css,
      /input\[type='range'\]\s*\{[\s\S]*?appearance: none;[\s\S]*?height: 16px;[\s\S]*?overflow: hidden;/
    )
    // Pure-CSS active-track fill: the thumb's oversized left box-shadow,
    // clipped by the input's rounded overflow. No JS gradient.
    assert.match(css, /-1000px 0 0 997px var\(--md-sys-color-primary\)/)
  })

  it('materializes progress as a 6px M3 linear bar', () => {
    const css = read('app', 'styles', '_material-controls.scss')
    assert.match(
      css,
      /progress\s*\{[\s\S]*?appearance: none;[\s\S]*?height: 6px;/
    )
    assert.match(
      css,
      /&::-webkit-progress-value\s*\{\s*background: var\(--md-sys-color-primary\);/
    )
    // The indeterminate stripe tracks the same 6px height.
    assert.match(
      read('app', 'styles', 'ui', '_progress.scss'),
      /background-size: 25px 6px/
    )
  })

  it('gives buttons the full-radius M3 pill shape', () => {
    const css = read('app', 'styles', '_material-controls.scss')
    assert.match(
      css,
      /\.button-component\s*\{\s*border-radius: 999px;\s*min-height: 32px;/
    )
  })

  it('leaves the context sliders as layout-only so the M3 layer wins', () => {
    const preferences = read('app', 'styles', 'ui', '_preferences.scss')
    const tabs = read('app', 'styles', 'ui', '_repository-tabs.scss')
    // The old round-thumb custom slider and native accent-color tints are gone;
    // only layout remains so `_material-controls.scss` renders every slider.
    assert.doesNotMatch(
      preferences,
      /\.scaling-slider[\s\S]*?::-webkit-slider-thumb/
    )
    assert.doesNotMatch(
      preferences,
      /input\[type='range'\][\s\S]*?accent-color/
    )
    assert.doesNotMatch(tabs, /input\[type='range'\][\s\S]*?accent-color/)
  })
})
