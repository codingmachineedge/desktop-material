import assert from 'node:assert'
import { describe, it } from 'node:test'
import { shell } from 'electron'
import { UNSAFE_openDirectory } from '../../../src/main-process/shell'

const waitForPromiseHandlers = () =>
  new Promise<void>(resolve => setImmediate(resolve))

describe('main-process shell', () => {
  it('logs an openPath rejection instead of leaving it unhandled', async () => {
    const failure = new Error('Explorer unavailable')
    const previousOpenPath = shell.openPath
    const previousLogError = log.error
    const errors = new Array<{ message: string; error?: Error }>()
    let openedPath: string | undefined

    shell.openPath = async path => {
      openedPath = path
      throw failure
    }
    log.error = (message, error) => errors.push({ message, error })

    try {
      UNSAFE_openDirectory('C:\\safe-directory')
      await waitForPromiseHandlers()

      assert.equal(
        openedPath,
        __WIN32__ ? 'C:\\safe-directory\\' : 'C:\\safe-directory'
      )
      assert.deepEqual(errors, [
        {
          message: 'Failed to open directory (C:\\safe-directory)',
          error: failure,
        },
      ])
    } finally {
      shell.openPath = previousOpenPath
      log.error = previousLogError
    }
  })

  it('keeps Electron error-string results actionable', async () => {
    const previousOpenPath = shell.openPath
    const previousLogError = log.error
    const messages = new Array<string>()
    shell.openPath = async () => 'No application is associated with this path'
    log.error = message => messages.push(message)

    try {
      UNSAFE_openDirectory('C:\\safe-directory')
      await waitForPromiseHandlers()

      assert.deepEqual(messages, [
        'Failed to open directory (C:\\safe-directory): No application is associated with this path',
      ])
    } finally {
      shell.openPath = previousOpenPath
      log.error = previousLogError
    }
  })
})
