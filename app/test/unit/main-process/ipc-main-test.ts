import assert from 'node:assert'
import { describe, it } from 'node:test'
// eslint-disable-next-line no-restricted-imports -- this test replaces Electron's raw registration methods.
import { ipcMain } from 'electron'
import type { IpcMainEvent, WebContents } from 'electron/main'
import { on } from '../../../src/main-process/ipc-main'
import { addTrustedIPCSender } from '../../../src/main-process/trusted-ipc-sender'

type SimplexListener = (event: IpcMainEvent) => void

type MutableIPCMain = {
  on: (channel: string, listener: SimplexListener) => void
  removeListener: (channel: string, listener: SimplexListener) => void
}

const waitForPromiseHandlers = () =>
  new Promise<void>(resolve => setImmediate(resolve))

describe('main-process IPC', () => {
  it('logs a rejected simplex listener promise without an unhandled rejection', async () => {
    const mutableIPCMain = ipcMain as unknown as MutableIPCMain
    const previousOn = mutableIPCMain.on
    const previousRemoveListener = mutableIPCMain.removeListener
    const previousLogError = log.error
    const failure = new Error('installation failed')
    const errors = new Array<{ message: string; error?: Error }>()
    let registeredListener: SimplexListener | undefined
    let removedListener: SimplexListener | undefined
    let removeTrustedSender: (() => void) | undefined

    mutableIPCMain.on = (_channel, listener) => {
      registeredListener = listener
    }
    mutableIPCMain.removeListener = (_channel, listener) => {
      removedListener = listener
    }
    log.error = (message, error) => errors.push({ message, error })

    const sender = {
      id: 42,
      on: (event: string, listener: () => void) => {
        if (event === 'destroyed') {
          removeTrustedSender = listener
        }
        return sender
      },
    } as unknown as WebContents
    addTrustedIPCSender(sender)

    try {
      const unsubscribe = on('install-windows-cli', async () => {
        throw failure
      })
      assert.notEqual(registeredListener, undefined)

      registeredListener?.({ sender } as IpcMainEvent)
      await waitForPromiseHandlers()

      assert.deepEqual(errors, [
        {
          message: 'Simplex IPC listener "install-windows-cli" failed',
          error: failure,
        },
      ])

      unsubscribe()
      assert.equal(removedListener, registeredListener)
    } finally {
      removeTrustedSender?.()
      mutableIPCMain.on = previousOn
      mutableIPCMain.removeListener = previousRemoveListener
      log.error = previousLogError
    }
  })
})
