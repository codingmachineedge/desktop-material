import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { IMenuItem } from '../../../src/lib/menu-item'
import { CommandPalette } from '../../../src/ui/command-palette/command-palette'
import { DialogStackContext } from '../../../src/ui/dialog'
import { showMaterialContextMenu } from '../../../src/ui/lib/material-context-menu'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

let restoreIpcSend: (() => void) | null = null
let restoreDialogShow: (() => void) | null = null

beforeEach(async () => {
  const electron = await import('electron')
  const previousSend = electron.ipcRenderer.send
  electron.ipcRenderer.send = () => {}
  restoreIpcSend = () => {
    electron.ipcRenderer.send = previousSend
    restoreIpcSend = null
  }

  const prototype = window.HTMLDialogElement.prototype
  const previousShow = prototype.show
  prototype.show = function () {
    this.setAttribute('open', '')
  }
  restoreDialogShow = () => {
    prototype.show = previousShow
    restoreDialogShow = null
  }
})

afterEach(() => {
  restoreIpcSend?.()
  restoreDialogShow?.()
})

describe('CommandPalette filter modes', () => {
  it('filters through the shared modes without submitting the dialog form', async () => {
    localStorage.removeItem('filter-mode/command-palette')
    const executed = new Array<string>()
    let dismissals = 0

    render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <CommandPalette
          onExecute={event => executed.push(event)}
          onDismissed={() => dismissals++}
        />
      </DialogStackContext.Provider>
    )

    const input = screen.getByRole('textbox', {
      name: 'Search command palette',
    })
    await waitFor(() => assert.equal(document.activeElement, input))
    assert.ok(screen.getByRole('button', { name: 'Open regex builder' }))

    fireEvent.change(input, { target: { value: 'clone' } })
    assert.ok(screen.getByRole('option', { name: /Clone a repository/ }))

    // The mode buttons carry no explicit type; cycling must not implicitly
    // submit the Dialog form (which would dismiss the palette).
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Filter mode: Fuzzy (click to change)',
      })
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Filter mode: Substring (click to change)',
      })
    )
    assert.equal(dismissals, 0)

    fireEvent.change(input, { target: { value: '^Push$' } })
    const options = screen.getAllByRole('option')
    assert.equal(options.length, 1)
    assert.match(options[0].textContent ?? '', /Push/)

    fireEvent.keyDown(input, { key: 'Enter' })
    assert.deepEqual(executed, ['push'])
    assert.equal(dismissals, 1)
  })

  it('edits persisted row appearance and keeps Escape inside the palette', async () => {
    localStorage.removeItem('language-mode-v1')
    localStorage.removeItem('command-palette-appearance-v1')
    let dismissals = 0

    render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <CommandPalette
          onExecute={() => undefined}
          onDismissed={() => dismissals++}
        />
      </DialogStackContext.Provider>
    )

    const toggle = screen.getByRole('button', {
      name: 'Customize command palette appearance',
    })
    fireEvent.click(toggle)
    assert.ok(
      screen.getByRole('dialog', {
        name: 'Command palette appearance settings',
      })
    )

    fireEvent.click(screen.getByRole('radio', { name: /Compact/ }))
    const icons = screen.getByRole('checkbox', { name: 'Icons' })
    fireEvent.click(icons)
    assert.deepEqual(
      JSON.parse(
        localStorage.getItem('command-palette-appearance-v1') ?? 'null'
      ),
      {
        density: 'compact',
        showIcons: false,
        showGroups: true,
        showKeywords: true,
      }
    )

    icons.focus()
    fireEvent.keyDown(icons, { key: 'Escape' })
    await waitFor(() =>
      assert.equal(
        screen.queryByRole('dialog', {
          name: 'Command palette appearance settings',
        }),
        null
      )
    )
    assert.ok(screen.getByRole('dialog', { name: 'Command palette' }))
    assert.equal(dismissals, 0)
    await waitFor(() => assert.equal(document.activeElement, toggle))
  })
})

describe('showMaterialContextMenu filter modes', () => {
  it('narrows actions per mode and still resolves the picked item', async () => {
    localStorage.removeItem('filter-mode/material-context-menu')
    const items: ReadonlyArray<IMenuItem> = [
      { label: 'Copy path' },
      { label: 'Reveal in Explorer' },
      { type: 'separator' },
      { label: 'Close others' },
    ]

    const menuPromise = showMaterialContextMenu(items)
    const input = await screen.findByLabelText('Filter menu actions')
    assert.ok(screen.getByLabelText('Open regex builder'))

    fireEvent.change(input, { target: { value: 'cp' } })
    assert.ok(screen.getByRole('menuitem', { name: 'Copy path' }))
    assert.equal(
      screen.queryByRole('menuitem', { name: 'Reveal in Explorer' }),
      null
    )

    // Substring mode requires a contiguous match instead of a subsequence.
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Filter mode: Fuzzy (click to change)',
      })
    )
    assert.equal(screen.queryByRole('menuitem', { name: 'Copy path' }), null)
    fireEvent.change(input, { target: { value: 'clo' } })
    assert.equal(screen.queryByRole('menuitem', { name: 'Copy path' }), null)

    fireEvent.click(screen.getByRole('menuitem', { name: 'Close others' }))
    const picked = await menuPromise
    assert.equal(picked?.label, 'Close others')
  })
})
