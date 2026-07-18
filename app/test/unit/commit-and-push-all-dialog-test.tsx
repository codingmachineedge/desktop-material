import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import {
  CommitPushAllProgressListener,
  ICommitPushAllResult,
} from '../../src/lib/automation/commit-push-all'
import { Dispatcher } from '../../src/ui/dispatcher'
import { CommitAndPushAllDialog } from '../../src/ui/commit-push-all'
import { fireEvent, render, screen, waitFor } from '../helpers/ui/render'

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
  const previousShowModal = prototype.showModal
  prototype.show = function () {
    this.setAttribute('open', '')
  }
  prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  restoreDialogShow = () => {
    prototype.show = previousShow
    prototype.showModal = previousShowModal
    restoreDialogShow = null
  }
})

afterEach(() => {
  restoreIpcSend?.()
  restoreDialogShow?.()
  document.body.innerHTML = ''
})

interface IDeferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

function deferred<T>(): IDeferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(onResolve => {
    resolve = onResolve
  })
  return { promise, resolve }
}

function createDispatcher(
  run: (
    message: string,
    listener?: CommitPushAllProgressListener
  ) => Promise<ReadonlyArray<ICommitPushAllResult>>
): Dispatcher {
  return { commitAndPushAllRepositories: run } as unknown as Dispatcher
}

const affected = [
  { id: 1, name: 'alpha' },
  { id: 2, name: 'beta' },
]

describe('CommitAndPushAllDialog', () => {
  it('lists affected repositories, requires a message, and invokes the dispatcher', async () => {
    const completion = deferred<ReadonlyArray<ICommitPushAllResult>>()
    let capturedMessage: string | null = null
    let listener: CommitPushAllProgressListener | undefined
    const dispatcher = createDispatcher((message, onProgress) => {
      capturedMessage = message
      listener = onProgress
      return completion.promise
    })

    render(
      React.createElement(CommitAndPushAllDialog, {
        dispatcher,
        affectedRepositories: affected,
        onDismissed: () => {},
      })
    )

    // The affected repositories are listed for review before confirming.
    assert.ok(screen.getByText('alpha'))
    assert.ok(screen.getByText('beta'))

    const okButton = screen.getByRole('button', {
      name: 'Commit & push all',
    }) as HTMLButtonElement

    // Clearing the required message disables the confirm button (the Button
    // component reflects disabled state via aria-disabled, not the property).
    const input = screen.getByLabelText('Commit message') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    await waitFor(() =>
      assert.equal(okButton.getAttribute('aria-disabled'), 'true')
    )

    // A confirmed message is passed verbatim to the dispatcher.
    fireEvent.change(input, { target: { value: 'Sync everything' } })
    await waitFor(() =>
      assert.equal(okButton.getAttribute('aria-disabled'), null)
    )
    fireEvent.click(okButton)

    await waitFor(() => assert.equal(capturedMessage, 'Sync everything'))

    // The dialog transitions to the live progress view.
    listener?.({
      completed: 0,
      total: 2,
      active: 1,
      item: { id: 1, name: 'alpha', status: 'pushing', detail: 'Pushing.' },
    })
    assert.ok(await screen.findByText('Pushing.'))

    // Final per-repository statuses arrive via the progress listener, then the
    // batch promise resolves and the summary is shown.
    listener?.({
      completed: 1,
      total: 2,
      active: 1,
      item: {
        id: 1,
        name: 'alpha',
        status: 'done',
        detail: 'Committed and pushed.',
      },
    })
    listener?.({
      completed: 2,
      total: 2,
      active: 0,
      item: {
        id: 2,
        name: 'beta',
        status: 'skipped',
        detail: 'Nothing to do.',
      },
    })
    completion.resolve([
      { id: 1, name: 'alpha', status: 'done', detail: 'Committed and pushed.' },
      { id: 2, name: 'beta', status: 'skipped', detail: 'Nothing to do.' },
    ])
    assert.ok(await screen.findByText('1 pushed, 1 skipped, 0 failed.'))
  })

  it('does not invoke the dispatcher when there is nothing to do', async () => {
    let calls = 0
    const dispatcher = createDispatcher(async () => {
      calls++
      return []
    })
    let dismissed = 0

    render(
      React.createElement(CommitAndPushAllDialog, {
        dispatcher,
        affectedRepositories: [],
        onDismissed: () => dismissed++,
      })
    )

    assert.ok(
      screen.getByText(/No repositories have local changes or unpushed commits/)
    )
    assert.equal(screen.queryByLabelText('Commit message'), null)

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    assert.equal(dismissed, 1)
    assert.equal(calls, 0)
  })
})
