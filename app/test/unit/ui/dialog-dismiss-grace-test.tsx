import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { Dialog, DialogStackContext } from '../../../src/ui/dialog/dialog'
import { fireEvent, render, screen } from '../../helpers/ui/render'

let restoreIpcSend: (() => void) | null = null
let restoreDialogShow: (() => void) | null = null

beforeEach(async () => {
  const electron = await import('electron')
  const previousSend = electron.ipcRenderer.send
  electron.ipcRenderer.send = () => undefined
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

describe('Dialog dismissal grace period', () => {
  it('restarts the grace timer when a backgrounded dialog becomes topmost', async () => {
    let dismissed = 0
    const renderDialog = (isTopMost: boolean) => (
      <DialogStackContext.Provider value={{ isTopMost }}>
        <Dialog title="Stacked dialog" onDismissed={() => dismissed++}>
          <p>Dialog content</p>
        </Dialog>
      </DialogStackContext.Provider>
    )

    const view = render(renderDialog(false))

    // The first timer is cancelled while the dialog is behind another popup.
    await new Promise(resolve => window.setTimeout(resolve, 300))
    view.rerender(renderDialog(true))

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    assert.equal(dismissed, 0)

    await new Promise(resolve => window.setTimeout(resolve, 300))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    assert.equal(dismissed, 1)
  })
})
