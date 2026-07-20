import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { translate, translateForAccessibleName } from '../../../src/lib/i18n'
import {
  DefaultAppearanceCustomization,
  IAppearanceCustomization,
} from '../../../src/models/appearance-customization'
import { SubmoduleBackButton } from '../../../src/ui/submodules/submodule-back-button'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

describe('Submodule Back button contextual appearance editor', () => {
  it('opens directly beside its owner, preserves the profile, and restores focus', async () => {
    const changes = new Array<IAppearanceCustomization>()

    function Harness() {
      const [appearance, setAppearance] =
        React.useState<IAppearanceCustomization>({
          ...DefaultAppearanceCustomization,
          accentPalette: 'rose',
        })

      return (
        <SubmoduleBackButton
          appearanceCustomization={appearance}
          parentName="parent"
          onAppearanceCustomizationChanged={next => {
            changes.push(next)
            setAppearance(next)
          }}
        />
      )
    }

    render(<Harness />)
    const button = screen.getByRole('button', { name: 'Back to parent' })
    assert.equal(button.getAttribute('aria-haspopup'), 'dialog')
    assert.equal(button.getAttribute('aria-expanded'), 'false')
    assert.equal(
      button
        .closest('[data-context-menu-owner="true"]')
        ?.getAttribute('data-customization-surface'),
      'submodule-back-button'
    )

    let documentSawPrevented = false
    const onDocumentContextMenu = (event: MouseEvent) => {
      documentSawPrevented = event.defaultPrevented
    }
    document.addEventListener('contextmenu', onDocumentContextMenu)
    const wasNotCancelled = fireEvent.contextMenu(button)
    document.removeEventListener('contextmenu', onDocumentContextMenu)

    assert.equal(wasNotCancelled, false)
    assert.equal(documentSawPrevented, true)
    const dialog = screen.getByRole('dialog', {
      name: 'Back button appearance',
    })
    assert.equal(button.getAttribute('aria-expanded'), 'true')
    const controlled = document.getElementById(
      button.getAttribute('aria-controls') ?? ''
    )
    assert.ok(controlled)
    assert.equal(dialog.contains(controlled), true)

    fireEvent.change(screen.getByLabelText('Submodule Back button style'), {
      target: { value: 'filled' },
    })
    fireEvent.change(screen.getByLabelText('Submodule Back button label'), {
      target: { value: 'parent-name' },
    })

    await waitFor(() => {
      assert.equal(changes.at(-1)?.submoduleBackButtonStyle, 'filled')
      assert.equal(changes.at(-1)?.submoduleBackButtonLabel, 'parent-name')
    })
    assert.equal(changes.at(-1)?.accentPalette, 'rose')
    assert.ok(button.classList.contains('submodule-context-back-filled'))
    assert.equal(
      button.querySelector('.submodule-context-back-label')?.textContent,
      'parent'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      assert.equal(screen.queryByRole('dialog'), null)
      assert.equal(document.activeElement, button)
    })
    assert.equal(button.getAttribute('aria-expanded'), 'false')
  })

  it('supports the keyboard Context Menu command and localized controls', () => {
    const appearance: IAppearanceCustomization = {
      ...DefaultAppearanceCustomization,
      languageMode: 'cantonese',
    }
    render(
      <SubmoduleBackButton
        appearanceCustomization={appearance}
        parentName="parent"
        onAppearanceCustomizationChanged={() => undefined}
      />
    )

    const button = screen.getByRole('button', {
      name: translateForAccessibleName(
        'submodule.backToParent',
        { parent: 'parent' },
        'cantonese'
      ),
    })
    fireEvent.keyDown(button, { key: 'F10', shiftKey: true })

    assert.ok(
      screen.getByRole('dialog', {
        name: translate('submodule.appearanceHeading', 'cantonese'),
      })
    )
    assert.ok(
      screen.getByLabelText(
        translate('appearance.submoduleBackStyle', 'cantonese')
      )
    )
    assert.ok(
      screen.getByLabelText(
        translate('appearance.submoduleBackLabel', 'cantonese')
      )
    )
  })
})
