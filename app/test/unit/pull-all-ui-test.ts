import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import {
  IRepositorySyncRequest,
  IPullAllProgressUpdate,
  IPullAllResult,
  PullAllProgressListener,
} from '../../src/lib/automation/pull-all'
import { Dispatcher } from '../../src/ui/dispatcher'
import { PullAllDialog } from '../../src/ui/pull-all/pull-all-dialog'
import { fireEvent, render, screen, waitFor } from '../helpers/ui/render'
import { LanguageModeChangedEvent } from '../../src/lib/i18n'

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
  document.body.innerHTML = ''
})

interface IDeferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: Error) => void
}

function deferred<T>(): IDeferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function progress(
  id: number,
  status: IPullAllProgressUpdate['item']['status'],
  detail: string,
  completed: number,
  active: number
): IPullAllProgressUpdate {
  return {
    completed,
    total: 2,
    active,
    item: { id, name: `repository-${id}`, status, detail },
  }
}

function createDispatcher(
  run: (
    request: IRepositorySyncRequest,
    listener?: PullAllProgressListener
  ) => Promise<ReadonlyArray<IPullAllResult>>,
  candidates = [
    { id: 1, name: 'repository-1' },
    { id: 2, name: 'repository-2' },
  ]
): Dispatcher {
  return {
    getRepositorySyncCandidates: async () => candidates,
    syncRepositories: run,
  } as unknown as Dispatcher
}

describe('PullAllDialog', () => {
  it('switches the reviewed dialog live across all language modes', async () => {
    localStorage.setItem(
      'appearance-customization-v1',
      JSON.stringify({ version: 1, languageMode: 'english' })
    )
    const view = render(
      React.createElement(PullAllDialog, {
        dispatcher: createDispatcher(async () => []),
        onDismissed: () => {},
      })
    )

    try {
      assert.ok(await screen.findByRole('button', { name: 'Start pull' }))

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'cantonese' })
      )
      await waitFor(() =>
        assert.ok(screen.getByRole('button', { name: '開始 Pull' }))
      )

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'bilingual' })
      )
      await waitFor(() =>
        assert.ok(
          screen.getByRole('button', { name: 'Start pull · 開始 Pull' })
        )
      )
    } finally {
      view.unmount()
      localStorage.removeItem('appearance-customization-v1')
    }
  })

  it('renders live progress, stays dismissible, and summarizes completion', async () => {
    const completion = deferred<ReadonlyArray<IPullAllResult>>()
    let listener: PullAllProgressListener | undefined
    let dismissed = 0
    const dispatcher = createDispatcher((_request, onProgress) => {
      listener = onProgress
      onProgress?.(progress(1, 'queued', 'Waiting for a worker.', 0, 0))
      onProgress?.(progress(2, 'queued', 'Waiting for a worker.', 0, 0))
      return completion.promise
    })

    render(
      React.createElement(PullAllDialog, {
        dispatcher,
        onDismissed: () => dismissed++,
      })
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Start pull' }))

    const progressbar = screen.getByRole('progressbar', {
      name: 'Repositories synchronized',
    })
    assert.equal(progressbar.getAttribute('aria-valuenow'), '0')
    assert.equal(
      (await screen.findAllByText('Waiting for a worker.')).length,
      2
    )
    assert.ok(screen.getByRole('region', { name: 'Repository sync progress' }))

    listener?.(
      progress(
        1,
        'pulling',
        'Checking the pull remote and active branch.',
        0,
        1
      )
    )
    assert.ok(screen.getByText('Checking the pull remote and active branch.'))
    assert.equal(
      screen.getByText('Pulling').classList.contains('pulling'),
      true
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run in background' }))
    assert.equal(dismissed, 1)

    listener?.(progress(1, 'pulled', 'Pull completed.', 1, 1))
    listener?.(progress(2, 'skipped', 'No pull remote.', 2, 0))
    completion.resolve([
      {
        id: 1,
        name: 'repository-1',
        status: 'pulled',
        detail: 'Pull completed.',
      },
      {
        id: 2,
        name: 'repository-2',
        status: 'skipped',
        detail: 'No pull remote.',
      },
    ])

    assert.ok(await screen.findByText('1 pulled, 1 skipped, 0 failed.'))
    assert.ok(screen.getByRole('button', { name: 'Done' }))
    assert.equal(progressbar.getAttribute('aria-valuenow'), '2')
  })

  it('reports a top-level failure and leaves the dialog dismissible', async () => {
    const dispatcher = createDispatcher(async () => {
      throw new Error('Unable to enumerate repositories.')
    })

    render(
      React.createElement(PullAllDialog, {
        dispatcher,
        onDismissed: () => {},
      })
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Start pull' }))

    const alert = await screen.findByRole('alert')
    assert.equal(alert.textContent, 'Unable to enumerate repositories.')
    assert.ok(screen.getByRole('button', { name: 'Done' }))
  })

  it('retains background progress across dismiss and reopen', async () => {
    const completion = deferred<ReadonlyArray<IPullAllResult>>()
    let listener: PullAllProgressListener | undefined
    let calls = 0
    const dispatcher = createDispatcher((_request, onProgress) => {
      calls++
      listener = onProgress
      return completion.promise
    })
    const view = render(
      React.createElement(PullAllDialog, {
        dispatcher,
        onDismissed: () => {},
      })
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Start pull' }))
    await waitFor(() => assert.notEqual(listener, undefined))
    view.unmount()
    listener?.(progress(1, 'pulling', 'Background update.', 0, 1))

    render(
      React.createElement(PullAllDialog, {
        dispatcher,
        onDismissed: () => {},
      })
    )
    assert.equal(calls, 1)
    assert.ok(screen.getByText('Background update.'))

    completion.resolve([])
  })

  it('starts a fresh run when the completed dialog is opened again', async () => {
    let calls = 0
    const dispatcher = createDispatcher(async () => {
      calls++
      return []
    })
    const firstView = render(
      React.createElement(PullAllDialog, {
        dispatcher,
        onDismissed: () => {},
      })
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Start pull' }))
    await screen.findByText('All repositories processed')
    firstView.unmount()

    render(
      React.createElement(PullAllDialog, {
        dispatcher,
        onDismissed: () => {},
      })
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Start pull' }))
    await waitFor(() => assert.equal(calls, 2))
  })

  it('runs fetch-only for the exact reviewed repository selection', async () => {
    let request: IRepositorySyncRequest | undefined
    const dispatcher = createDispatcher(async (current, onProgress) => {
      request = current
      onProgress?.({
        completed: 1,
        total: 1,
        active: 0,
        item: {
          id: 2,
          name: 'repository-2',
          status: 'fetched',
          detail: 'Fetch completed.',
        },
      })
      return [
        {
          id: 2,
          name: 'repository-2',
          status: 'fetched',
          detail: 'Fetch completed.',
        },
      ]
    })

    render(
      React.createElement(PullAllDialog, {
        dispatcher,
        onDismissed: () => {},
      })
    )

    fireEvent.click(
      await screen.findByRole('radio', {
        name: 'Fetch only (leave worktrees unchanged)',
      })
    )
    fireEvent.click(screen.getByRole('checkbox', { name: 'repository-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start fetch' }))

    await waitFor(() => assert.notEqual(request, undefined))
    assert.deepEqual(request, { operation: 'fetch', repositoryIds: [2] })
    assert(await screen.findByText('1 fetched, 0 skipped, 0 failed.'))
  })
})
