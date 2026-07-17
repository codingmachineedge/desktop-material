import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { resolve } from 'node:path'

const styles = readFileSync(
  resolve(__dirname, '../../styles/ui/_first-run-checklist.scss'),
  'utf8'
)

const component = readFileSync(
  resolve(__dirname, '../../src/ui/welcome/first-run-checklist.tsx'),
  'utf8'
)

const uiManifest = readFileSync(
  resolve(__dirname, '../../styles/_ui.scss'),
  'utf8'
)

describe('first-run checklist v2 design contract', () => {
  it('is imported by the ui stylesheet manifest', () => {
    assert.match(uiManifest, /@import 'ui\/first-run-checklist';/)
  })

  it('renders a 560px expressive card over a 40% scrim', () => {
    assert.match(styles, /dialog\.first-run-checklist\s*\{/)
    assert.match(styles, /width:\s*560px/)
    assert.match(styles, /max-width:\s*calc\(100vw - 48px\)/)
    assert.match(styles, /padding:\s*28px/)
    assert.match(
      styles,
      /border-radius:\s*var\(--md-sys-shape-corner-extra-large\)/
    )
    assert.match(
      styles,
      /background:\s*var\(--md-sys-color-surface-container-low\)/
    )
    assert.match(styles, /box-shadow:\s*var\(--md-sys-elevation-level3\)/)
    assert.match(
      styles,
      /animation:\s*dmDialog calc\(520ms \* var\(--mdur, 1\)\) var\(--spring\)/
    )
    assert.match(
      styles,
      /&::backdrop\s*\{[\s\S]*?color-mix\(in srgb, var\(--md-sys-color-scrim\) 40%, transparent\)[\s\S]*?animation:\s*dmScrim 300ms var\(--emph\)/
    )
  })

  it('shows a primary product lockup beside the two-line heading', () => {
    assert.match(
      styles,
      /\.first-run-checklist-lockup\s*\{[\s\S]*?width:\s*52px[\s\S]*?height:\s*52px[\s\S]*?border-radius:\s*16px[\s\S]*?background:\s*var\(--md-sys-color-primary\)[\s\S]*?color:\s*var\(--md-sys-color-on-primary\)/
    )
    assert.match(component, /className="first-run-checklist-lockup"/)
    assert.match(component, /Welcome to Desktop Material/)
    assert.match(component, /Three steps and your Git workflow is ready\./)
  })

  it('lays the three steps out as tonal rows with done and next states', () => {
    assert.match(
      styles,
      /\.first-run-checklist-item\s*\{[\s\S]*?gap:\s*12px[\s\S]*?padding:\s*12px 14px[\s\S]*?border-radius:\s*16px[\s\S]*?background:\s*var\(--md-sys-color-surface-container\)/
    )
    assert.match(
      styles,
      /\.first-run-checklist-item--next\s*\{[\s\S]*?border:\s*2px solid var\(--md-sys-color-primary\)/
    )
    assert.match(
      styles,
      /\.first-run-checklist-item--done \.first-run-checklist-item-icon\s*\{[\s\S]*?color:\s*var\(--md-sys-color-primary\)/
    )
    assert.match(component, /octicons\.checkCircleFill/)
    assert.match(component, /Sign in/)
    assert.match(component, /Clone your first repository/)
    assert.match(component, /Pick a theme/)
    assert.match(component, /GitHub · GitLab · Bitbucket/)
    assert.match(component, /multi-clone · org filters/)
    assert.match(component, /light · dark · follow system/)
  })

  it('paints the striped 120px workspace-preview strip', () => {
    assert.match(
      styles,
      /\.first-run-checklist-preview\s*\{[\s\S]*?height:\s*120px[\s\S]*?border:\s*1px solid var\(--md-sys-color-outline-variant\)/
    )
    assert.match(
      styles,
      /repeating-linear-gradient\(\s*45deg,\s*var\(--md-sys-color-surface-container\),\s*var\(--md-sys-color-surface-container\) 10px,\s*var\(--md-sys-color-surface-container-high\) 10px,\s*var\(--md-sys-color-surface-container-high\) 20px\s*\)/
    )
    assert.match(
      styles,
      /\.first-run-checklist-preview-badge\s*\{[\s\S]*?border-radius:\s*999px[\s\S]*?background:\s*var\(--md-sys-color-surface-container-lowest\)[\s\S]*?font-family:\s*var\(--font-family-monospace\)/
    )
    assert.match(component, /responsive workspace preview/)
  })

  it('closes with pill-shaped skip and get-started actions', () => {
    assert.match(
      styles,
      /\.first-run-checklist-skip,\s*\.first-run-checklist-start\s*\{[\s\S]*?height:\s*40px[\s\S]*?border-radius:\s*999px/
    )
    assert.match(
      styles,
      /\.first-run-checklist-skip\s*\{[\s\S]*?background:\s*transparent[\s\S]*?color:\s*var\(--md-sys-color-primary\)/
    )
    assert.match(
      styles,
      /\.first-run-checklist-start\s*\{[\s\S]*?background:\s*var\(--md-sys-color-primary\)[\s\S]*?color:\s*var\(--md-sys-color-on-primary\)/
    )
    assert.match(component, /Skip for now/)
    assert.match(component, /Get started/)
  })

  it('gates on the dismissal flag and routes actions through popups', () => {
    assert.match(component, /'first-run-checklist-dismissed-v1'/)
    assert.match(
      component,
      /getBoolean\(FirstRunChecklistDismissedKey, false\)/
    )
    assert.match(component, /setBoolean\(FirstRunChecklistDismissedKey, true\)/)
    assert.match(
      component,
      /type: PopupType\.Preferences,\s*initialSelectedTab: PreferencesTab\.Accounts/
    )
    assert.match(
      component,
      /type: PopupType\.CloneRepository,\s*initialURL: null/
    )
    assert.match(
      component,
      /type: PopupType\.Preferences,\s*initialSelectedTab: PreferencesTab\.Appearance/
    )
  })

  it('stays accessible: labelled native modal, focus and escape handling', () => {
    assert.match(component, /aria-labelledby="first-run-checklist-title"/)
    assert.match(component, /aria-describedby="first-run-checklist-subtitle"/)
    assert.match(component, /showModal\(\)/)
    assert.match(
      component,
      /addEventListener\('cancel', this\.onDialogCancel\)/
    )
    assert.match(component, /addEventListener\('click', this\.onDialogClick\)/)
    assert.match(component, /className="sr-only"/)
    assert.match(component, /aria-hidden="true"/)
    assert.match(styles, /:focus-visible/)
    assert.doesNotMatch(component, /\stitle=/)
  })

  it('uses Material tokens only, with no literal colors', () => {
    assert.doesNotMatch(styles, /#[0-9a-fA-F]{3,8}\b/)
    assert.doesNotMatch(styles, /rgba?\(/)
  })
})
