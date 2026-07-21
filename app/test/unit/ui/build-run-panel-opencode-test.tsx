import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'
import { Repository } from '../../../src/models/repository'
import { defaultBuildRunPreferences } from '../../../src/models/build-run-preferences'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { PopupType } from '../../../src/models/popup'
import { BuildRunPanel } from '../../../src/ui/build-run/build-run-panel'
import {
  BuildRunStore,
  IRepositoryBuildRunState,
} from '../../../src/lib/stores/build-run-store'
import { fireEvent, render, screen, within } from '../../helpers/ui/render'

function baseState(): IRepositoryBuildRunState {
  return {
    phase: 'failed',
    detectedProfiles: [],
    selectedProfileId: null,
    logLines: [{ stage: 'build', stream: 'stderr', text: 'error: boom' }],
    activeRunId: null,
    exitCode: 2,
    runPid: null,
    panelOpen: true,
    panelMinimized: false,
    detected: true,
    opencodeRunning: false,
    opencodeOperationId: null,
  }
}

function failedState(): IRepositoryBuildRunState {
  return baseState()
}

function stateWith(
  overrides: Partial<IRepositoryBuildRunState>
): IRepositoryBuildRunState {
  return { ...baseState(), ...overrides }
}

function fakeStore(state: IRepositoryBuildRunState): BuildRunStore {
  return {
    getStateForRepository: () => state,
    onDidUpdate: () => ({ dispose: () => {} }),
  } as unknown as BuildRunStore
}

function repository(offerOpencodeAutoFix: boolean) {
  return new Repository(
    'C:/opencode-repo',
    1,
    null,
    false,
    null,
    {},
    false,
    undefined,
    null,
    { ...defaultBuildRunPreferences, offerOpencodeAutoFix }
  )
}

describe('BuildRunPanel — Fix with opencode', () => {
  it('hides the button when the offer preference is off', () => {
    render(
      <BuildRunPanel
        repository={repository(false)}
        dispatcher={{} as Dispatcher}
        buildRunStore={fakeStore(failedState())}
      />
    )

    assert.equal(
      screen.queryByRole('button', { name: /fix with opencode/i }),
      null
    )
  })

  it('opens the OpencodeFix popup with the failure context when clicked', () => {
    const popups: Array<{ type: PopupType }> = []
    const dispatcher = {
      showPopup: (popup: { type: PopupType }) => {
        popups.push(popup)
        return Promise.resolve()
      },
    } as unknown as Dispatcher

    render(
      <BuildRunPanel
        repository={repository(true)}
        dispatcher={dispatcher}
        buildRunStore={fakeStore(failedState())}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /fix with opencode/i }))

    assert.equal(popups.length, 1)
    const popup = popups[0] as {
      type: PopupType
      failure: { stageKind: string; exitCode: number; cwd: string }
    }
    assert.equal(popup.type, PopupType.OpencodeFix)
    assert.equal(popup.failure.stageKind, 'build')
    assert.equal(popup.failure.exitCode, 2)
    assert.equal(popup.failure.cwd, 'C:/opencode-repo')
  })
})

function renderPanel(
  state: IRepositoryBuildRunState,
  dispatcher: Partial<Dispatcher> = {}
) {
  return render(
    <BuildRunPanel
      repository={repository(true)}
      dispatcher={dispatcher as Dispatcher}
      buildRunStore={fakeStore(state)}
    />
  )
}

function closeButton(): HTMLElement {
  return screen.getByRole('button', { name: /close panel/i })
}

describe('BuildRunPanel — close button while running', () => {
  it('disables the close button during a live build phase', () => {
    renderPanel(stateWith({ phase: 'running', activeRunId: 'run-1' }))
    assert.equal(closeButton().getAttribute('aria-disabled'), 'true')
  })

  it('disables the close button while detecting', () => {
    renderPanel(stateWith({ phase: 'detecting', activeRunId: 'run-1' }))
    assert.equal(closeButton().getAttribute('aria-disabled'), 'true')
  })

  it('disables the close button while opencode is running', () => {
    renderPanel(
      stateWith({
        phase: 'failed',
        opencodeRunning: true,
        opencodeOperationId: 'op-1',
      })
    )
    assert.equal(closeButton().getAttribute('aria-disabled'), 'true')
  })

  it('enables the close button when idle or on a terminal phase', () => {
    for (const phase of ['failed', 'succeeded', 'cancelled', 'idle'] as const) {
      const { unmount } = renderPanel(stateWith({ phase, activeRunId: null }))
      assert.equal(
        closeButton().getAttribute('aria-disabled'),
        null,
        `close should be enabled for phase ${phase}`
      )
      unmount()
    }
  })
})

describe('BuildRunPanel — opencode running status chip', () => {
  it('shows a running "Fixing with OpenCode" chip, not "Failed"', () => {
    renderPanel(
      stateWith({
        phase: 'failed',
        opencodeRunning: true,
        opencodeOperationId: 'op-1',
      })
    )
    const chip = screen.getByRole('status')
    assert.ok(/fixing with opencode/i.test(chip.textContent ?? ''))
    assert.equal(screen.queryByText('Failed'), null)
  })

  it('offers Stop and hides "Fix with opencode" while opencode runs', () => {
    renderPanel(
      stateWith({
        phase: 'failed',
        opencodeRunning: true,
        opencodeOperationId: 'op-1',
      })
    )
    assert.ok(screen.getByRole('button', { name: 'Stop' }))
    assert.equal(
      screen.queryByRole('button', { name: /fix with opencode/i }),
      null
    )
  })
})

describe('BuildRunPanel — Stop confirmation', () => {
  // The Dialog sends an IPC message and opens the native <dialog> on mount;
  // neither is wired in jsdom, so stub them for each test in this suite.
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

  it('opens a confirmation dialog instead of stopping immediately', () => {
    const calls: Array<unknown> = []
    const dispatcher = {
      cancelBuildRun: (repo: unknown) => {
        calls.push(repo)
        return Promise.resolve()
      },
    }
    renderPanel(
      stateWith({ phase: 'running', activeRunId: 'run-1' }),
      dispatcher
    )

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    assert.ok(screen.getByRole('alertdialog'))
    assert.equal(calls.length, 0)
  })

  it('calls the stop path only after confirming', () => {
    const calls: Array<unknown> = []
    const dispatcher = {
      cancelBuildRun: (repo: unknown) => {
        calls.push(repo)
        return Promise.resolve()
      },
    }
    renderPanel(
      stateWith({ phase: 'running', activeRunId: 'run-1' }),
      dispatcher
    )

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }))

    assert.equal(calls.length, 1)
  })

  it('does not call the stop path when cancelled', () => {
    const calls: Array<unknown> = []
    const dispatcher = {
      cancelBuildRun: (repo: unknown) => {
        calls.push(repo)
        return Promise.resolve()
      },
    }
    renderPanel(
      stateWith({ phase: 'running', activeRunId: 'run-1' }),
      dispatcher
    )

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    assert.equal(calls.length, 0)
    assert.equal(screen.queryByRole('alertdialog'), null)
  })
})
