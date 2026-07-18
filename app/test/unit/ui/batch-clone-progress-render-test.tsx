import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { Dispatcher } from '../../../src/ui/dispatcher'
import { BatchCloneProgress } from '../../../src/ui/clone-repository/batch-clone-progress'
import {
  BatchCloneMode,
  IBatchCloneItem,
  IBatchCloneItemStatus,
  IBatchCloneState,
} from '../../../src/models/batch-clone'
import { SubmoduleFetchStage } from '../../../src/models/progress'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

// The Dialog component sends an IPC message and opens the native <dialog> on
// mount; neither is wired in jsdom, so stub them for the lifetime of each test.
let restoreDialogEnv: (() => void) | null = null

beforeEach(async () => {
  const electron = await import('electron')
  const previousSend = electron.ipcRenderer.send
  electron.ipcRenderer.send = () => undefined

  const prototype = window.HTMLDialogElement.prototype
  const previousShow = prototype.show
  const previousShowModal = prototype.showModal
  prototype.show = function () {
    this.setAttribute('open', '')
  }
  prototype.showModal = function () {
    this.setAttribute('open', '')
  }

  restoreDialogEnv = () => {
    electron.ipcRenderer.send = previousSend
    prototype.show = previousShow
    prototype.showModal = previousShowModal
    restoreDialogEnv = null
  }
})

afterEach(() => {
  restoreDialogEnv?.()
})

const dispatcher = {} as unknown as Dispatcher

const item: IBatchCloneItem = {
  url: 'https://github.com/desktop/desktop.git',
  name: 'desktop',
  path: 'C:/clones/desktop',
}

function stateWith(status: IBatchCloneItemStatus): IBatchCloneState {
  return {
    items: [item],
    statuses: new Map([[item.path, status]]),
    mode: BatchCloneMode.Parallel,
    isRunning: true,
    isPaused: false,
    source: 'manual',
    overallProgress: status.progress ?? 0,
    isDone: false,
    recoveryUnavailable: false,
  }
}

function renderState(state: IBatchCloneState) {
  return render(
    <BatchCloneProgress
      dispatcher={dispatcher}
      onDismissed={() => {}}
      batchCloneState={state}
      isTopMost={true}
    />
  )
}

describe('BatchCloneProgress rows', () => {
  it('renders a per-repo stage, percent, speed, and ETA', () => {
    const view = renderState(
      stateWith({
        kind: 'cloning',
        progress: 0.42,
        stage: 'Receiving objects',
        description: 'Receiving objects: 42% (42/100)',
        speedBytesPerSecond: 2.4 * 1024 ** 2,
        etaSeconds: 90,
      })
    )

    const stage = view.baseElement.querySelector('.batch-clone-item .stage')
    assert.equal(stage?.textContent, 'Receiving objects — 42%')

    const meta = view.baseElement.querySelector('.batch-clone-item .meta')
    assert.ok(meta?.textContent?.includes('MiB/s'))
    assert.ok(meta?.textContent?.includes('~1m 30s left'))
  })

  it('offers per-row Use existing folder and Skip actions for review items', () => {
    const adopted: string[] = []
    const skipped: string[] = []
    const reviewDispatcher = {
      adoptBatchCloneItem: async (path: string) => {
        adopted.push(path)
      },
      skipBatchCloneItem: async (path: string) => {
        skipped.push(path)
      },
    } as unknown as Dispatcher

    render(
      <BatchCloneProgress
        dispatcher={reviewDispatcher}
        onDismissed={() => {}}
        batchCloneState={stateWith({
          kind: 'review',
          error: new Error('The final clone destination is occupied.'),
        })}
        isTopMost={true}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Use existing folder' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))

    assert.deepEqual(adopted, [item.path])
    assert.deepEqual(skipped, [item.path])
  })

  it('shows a soft recovery notice without a modal when journaling is unavailable', () => {
    const view = renderState({
      ...stateWith({ kind: 'cloning', progress: 0.3 }),
      recoveryUnavailable: true,
    })

    const notice = view.baseElement.querySelector(
      '.batch-clone-recovery-notice'
    )
    assert.ok(notice)
    assert.match(notice?.textContent ?? '', /Crash recovery is paused/i)
  })

  it('hides the recovery notice when journaling is healthy', () => {
    const view = renderState(stateWith({ kind: 'cloning', progress: 0.3 }))
    assert.equal(
      view.baseElement.querySelector('.batch-clone-recovery-notice'),
      null
    )
  })

  it('labels the submodule-fetch phase with an indeterminate bar', () => {
    const view = renderState(
      stateWith({
        kind: 'cloning',
        progress: 1,
        stage: SubmoduleFetchStage,
        description: "Cloning into 'vendor/dep'...",
      })
    )

    const stage = view.baseElement.querySelector('.batch-clone-item .stage')
    assert.equal(stage?.textContent, 'Fetching submodules')

    const progress = view.baseElement.querySelector(
      '.batch-clone-item progress'
    )
    assert.equal(progress?.hasAttribute('value'), false)
  })

  it('keeps Done open until durable batch dismissal succeeds', async () => {
    let finishSuccessfulDismissal: (result: boolean) => void = () => {}
    const successfulDismissal = new Promise<boolean>(resolve => {
      finishSuccessfulDismissal = resolve
    })
    let dismissalCalls = 0
    let dismissed = 0
    const dismissalDispatcher = {
      dismissBatchClone: () => {
        dismissalCalls += 1
        return dismissalCalls === 1
          ? Promise.resolve(false)
          : successfulDismissal
      },
    } as unknown as Dispatcher

    render(
      <BatchCloneProgress
        dispatcher={dismissalDispatcher}
        onDismissed={() => {
          dismissed += 1
        }}
        batchCloneState={{
          ...stateWith({ kind: 'failed' }),
          isRunning: false,
          isDone: true,
          overallProgress: 1,
        }}
        isTopMost={true}
      />
    )

    const done = screen.getByRole('button', { name: 'Done' })
    fireEvent.click(done)
    await waitFor(() => assert.equal(dismissalCalls, 1))
    await Promise.resolve()
    assert.equal(dismissed, 0)
    assert.ok(screen.getByRole('button', { name: 'Done' }))

    fireEvent.click(done)
    fireEvent.click(done)
    assert.equal(dismissalCalls, 2, 'repeat activation is ignored in flight')
    finishSuccessfulDismissal(true)
    await waitFor(() => assert.equal(dismissed, 1))
    assert.equal(dismissalCalls, 2)
  })
})
