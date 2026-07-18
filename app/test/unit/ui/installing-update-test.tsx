import assert from 'node:assert'
import { describe, it } from 'node:test'

import { Dispatcher } from '../../../src/ui/dispatcher'
import { InstallingUpdate } from '../../../src/ui/installing-update/installing-update'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('InstallingUpdate', () => {
  it('keeps an accepted Quit anyway request alive while shutdown drains', async () => {
    const shutdown = deferred<void>()
    let cancelled = 0
    const dispatcher = {
      quitApp: (evenIfUpdating: boolean) => {
        assert.equal(evenIfUpdating, true)
        return shutdown.promise
      },
      cancelQuittingApp: () => {
        cancelled++
      },
    } as unknown as Dispatcher
    const component = new InstallingUpdate({
      dispatcher,
      onDismissed: () => {},
    })

    ;(
      component as unknown as {
        onQuitAnywayButtonClicked: () => void
      }
    ).onQuitAnywayButtonClicked()
    component.componentWillUnmount()

    assert.equal(cancelled, 0)
    shutdown.resolve()
    await shutdown.promise
  })

  it('cancels a pending quit when dismissed without accepting it', () => {
    let cancelled = 0
    const dispatcher = {
      cancelQuittingApp: () => {
        cancelled++
      },
    } as unknown as Dispatcher
    const component = new InstallingUpdate({
      dispatcher,
      onDismissed: () => {},
    })

    component.componentWillUnmount()

    assert.equal(cancelled, 1)
  })
})
