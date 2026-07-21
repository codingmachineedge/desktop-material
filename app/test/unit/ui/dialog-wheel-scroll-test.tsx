import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { Dialog, DialogStackContext } from '../../../src/ui/dialog/dialog'
import { fireEvent, render } from '../../helpers/ui/render'

let restoreIpcSend: (() => void) | null = null
let restoreDialogShow: (() => void) | null = null

function setScrollRange(
  element: HTMLElement,
  clientHeight: number,
  scrollHeight: number,
  scrollTop = 0
) {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, value: scrollHeight },
    scrollTop: { configurable: true, value: scrollTop, writable: true },
  })
}

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

describe('Dialog wheel scrolling', () => {
  it('scrolls the dialog body from a descendant and brings its panel forward', () => {
    let frontRequests = 0
    const view = render(
      <DialogStackContext.Provider
        value={{
          isTopMost: false,
          onRequestFront: () => frontRequests++,
        }}
      >
        <Dialog title="Scrollable dialog">
          <div className="dialog-content">
            <button type="button">Anywhere in the content</button>
          </div>
        </Dialog>
      </DialogStackContext.Provider>
    )

    const content = view.container.querySelector<HTMLElement>('.dialog-content')
    const button = view.getByRole('button', { name: 'Anywhere in the content' })
    assert.ok(content !== null)
    setScrollRange(content, 100, 500)

    fireEvent.wheel(button, { deltaY: 48, deltaMode: 0 })

    assert.equal(content.scrollTop, 48)
    assert.equal(frontRequests, 1)
  })

  it('preserves nested scroll ownership and chains at the nested edge', () => {
    const view = render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <Dialog title="Nested scrolling">
          <div className="dialog-content">
            <div className="nested-scroll" style={{ overflowY: 'auto' }}>
              <button type="button">Nested content</button>
            </div>
          </div>
        </Dialog>
      </DialogStackContext.Provider>
    )

    const outer = view.container.querySelector<HTMLElement>('.dialog-content')
    const nested = view.container.querySelector<HTMLElement>('.nested-scroll')
    const button = view.getByRole('button', { name: 'Nested content' })
    assert.ok(outer !== null)
    assert.ok(nested !== null)
    setScrollRange(outer, 200, 800)
    setScrollRange(nested, 100, 300)

    fireEvent.wheel(button, { deltaY: 60, deltaMode: 0 })
    assert.equal(nested.scrollTop, 60)
    assert.equal(outer.scrollTop, 0)

    nested.scrollTop = 200
    fireEvent.wheel(button, { deltaY: 40, deltaMode: 0 })
    assert.equal(nested.scrollTop, 200)
    assert.equal(outer.scrollTop, 40)
  })

  it('leaves prevented child gestures and zoom gestures untouched', () => {
    const view = render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <Dialog title="Owned gestures">
          <div className="dialog-content">
            <button type="button" onWheel={event => event.preventDefault()}>
              Wheel-owning control
            </button>
          </div>
        </Dialog>
      </DialogStackContext.Provider>
    )

    const content = view.container.querySelector<HTMLElement>('.dialog-content')
    const button = view.getByRole('button', { name: 'Wheel-owning control' })
    assert.ok(content !== null)
    setScrollRange(content, 100, 500)

    fireEvent.wheel(button, { deltaY: 50, deltaMode: 0 })
    assert.equal(content.scrollTop, 0)

    fireEvent.wheel(content, { deltaY: 50, deltaMode: 0, ctrlKey: true })
    assert.equal(content.scrollTop, 0)
  })
})
