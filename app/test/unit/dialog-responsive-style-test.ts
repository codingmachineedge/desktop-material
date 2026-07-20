import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const readStyle = (name: string) =>
  readFileSync(join(process.cwd(), 'app', 'styles', 'ui', name), 'utf8')

describe('compact dialog responsive contracts', () => {
  it('lets the Preferences pane shrink vertically and keeps Agent QR content bounded', () => {
    const preferences = readStyle('_preferences.scss')
    const agent = readStyle('_agent-access.scss')

    assert.match(
      preferences,
      /\.tab-container\s*\{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;[\s\S]*?min-height: 0;[\s\S]*?overflow-x: hidden;[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      agent,
      /\.agent-qr-surface\s*\{[\s\S]*?max-width: 100%;[\s\S]*?height: auto;[\s\S]*?aspect-ratio: 1;[\s\S]*?svg\s*\{[\s\S]*?width: 100%;[\s\S]*?max-width: 176px;[\s\S]*?height: auto;/
    )
    assert.match(
      agent,
      /\.agent-device-list\s*\{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;[\s\S]*?li\s*\{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/
    )
  })

  it('contains long SSH prompt labels, fields, actions, and output', () => {
    const dialog = readStyle('_dialog.scss')
    const password = readStyle('_password-text-box.scss')
    const repositorySettings = readStyle('dialogs/_repository-settings.scss')

    assert.match(
      dialog,
      /&#ssh-user-password,\s*&#ssh-key-passphrase,\s*&#add-ssh-host\s*\{[\s\S]*?width: min\(520px, calc\(100vw - var\(--spacing-double\)\)\);[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      password,
      /\.password-text-box\s*\{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;[\s\S]*?\.text-box-component\s*\{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/
    )
    assert.match(
      repositorySettings,
      /\.ssh-working-copy-fields\s*\{[\s\S]*?min-width: 0;[\s\S]*?\.text-box-component,[\s\S]*?\.select-component\s*\{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/
    )
    assert.match(
      repositorySettings,
      /\.ssh-working-copy-results\s*\{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;[\s\S]*?pre\s*\{[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;[\s\S]*?overflow: auto;/
    )
  })

  it('widens Repository Settings while keeping submodule and subtree tools responsive', () => {
    const repositorySettings = readStyle('dialogs/_repository-settings.scss')
    const submoduleBackButton = readStyle('_submodule-back-button.scss')
    const subtreeManager = readStyle('_subtree-manager.scss')

    assert.match(
      repositorySettings,
      /#repository-settings\s*\{[\s\S]*?width: min\(960px, calc\(100vw - var\(--spacing-double\)\)\);/
    )
    assert.match(
      submoduleBackButton,
      /\.submodule-back-appearance-editor\s*\{[\s\S]*?width: min\(280px, calc\(var\(--available-width, 100vw\) - 32px\)\);[\s\S]*?max-height: min\(360px, calc\(var\(--available-height, 100vh\) - 32px\)\);[\s\S]*?overflow-y: auto;/
    )
    assert.match(
      submoduleBackButton,
      /@media \(max-width: 420px\), \(max-height: 480px\)[\s\S]*?max-width: calc\(100vw - 36px\);[\s\S]*?max-height: calc\(var\(--available-height, 100vh\) - 20px\);/
    )
    assert.match(
      subtreeManager,
      /#subtree-manager,\s*#repository-settings\s*\{[\s\S]*?\.subtrees-manager\s*\{[\s\S]*?min-width: 0;/
    )
    assert.match(
      subtreeManager,
      /@container repository-settings-pane \(max-width: 620px\)\s*\{[\s\S]*?\.subtree-row-body\s*\{[\s\S]*?flex-direction: column;[\s\S]*?\.subtree-editor-fields\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    )
  })

  it('bounds recovered workflow dialogs at narrow width and compact height', () => {
    const actions = readStyle('_actions-view.scss')

    assert.match(
      actions,
      /\.workflow-dispatch-dialog\.workflow-dispatch-popover\s*\{[\s\S]*?max-width: 100%;[\s\S]*?max-height: calc\(100vh - 48px\);[\s\S]*?min-height: 0;[\s\S]*?overscroll-behavior: contain;/
    )
    assert.match(
      actions,
      /\.workflow-catalog-dialog\s*\{[\s\S]*?max-width: calc\(100vw - 16px\);[\s\S]*?max-height: calc\(100vh - 16px\);[\s\S]*?min-width: 0;[\s\S]*?min-height: 0;[\s\S]*?overflow: hidden;/
    )
    assert.match(
      actions,
      /@media \(max-height: 520px\)\s*\{[\s\S]*?\.workflow-catalog-dialog\s*\{[\s\S]*?height: calc\(100vh - var\(--spacing-double\)\);[\s\S]*?\.workflow-catalog-grid\s*\{[\s\S]*?padding: 2px 8px 8px;/
    )
  })

  it('lets version-history error and restore controls wrap without escaping the sheet', () => {
    const history = readStyle('_versioned-store-history.scss')

    assert.match(
      history,
      /\.versioned-store-history-error\s*\{[\s\S]*?min-width: 0;[\s\S]*?> span\s*\{[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;[\s\S]*?\.button-component\s*\{[\s\S]*?max-width: 100%;/
    )
    assert.match(
      history,
      /\.versioned-store-history-restore-confirmation\s*\{[\s\S]*?min-width: 0;[\s\S]*?flex-wrap: wrap;[\s\S]*?> span\s*\{[\s\S]*?overflow-wrap: anywhere;/
    )
    assert.match(
      history,
      /\.versioned-store-history-details-title\s*\{[\s\S]*?min-width: 0;[\s\S]*?flex-wrap: wrap;[\s\S]*?h2\s*\{[\s\S]*?overflow-wrap: anywhere;/
    )
  })

  it('keeps the fork dialog width and route responsive through the shared shell', () => {
    const fork = readStyle('dialogs/_create-fork.scss')
    const shell = readStyle('_dialog-layer.scss')

    assert.match(fork, /width: min\(560px, calc\(100vw - 32px\)\);/)
    assert.match(
      fork,
      /@media \(max-width: 520px\)\s*\{[\s\S]*?\.create-fork-route\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    )
    assert.match(
      shell,
      /dialog\s*\{[\s\S]*?&\[open\]\s*\{[\s\S]*?max-height: calc\(100vh - 54px\);[\s\S]*?min-height: 0;[\s\S]*?overflow: hidden;/
    )
  })
})
