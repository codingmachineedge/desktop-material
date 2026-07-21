import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { Disposable } from 'event-kit'
import * as React from 'react'
import { Repository } from '../../../src/models/repository'
import { defaultBuildRunPreferences } from '../../../src/models/build-run-preferences'
import { Dispatcher } from '../../../src/ui/dispatcher'
import {
  IOpencodeFixDialogProps,
  IOpencodeReRunObserver,
  OpencodeFixDialog,
} from '../../../src/ui/build-run/opencode-fix-dialog'
import { BuildRunViewPhase } from '../../../src/lib/stores/build-run-store'
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

interface IRunFixCall {
  readonly autoApprove: boolean
  readonly stageKind: string
  readonly cwd: string
}

interface IFakeDispatcherOptions {
  readonly detect: () => Promise<{
    installed: boolean
    version: string | null
    authConfigured: boolean
  }>
  readonly onInstall?: () => void
  readonly runResult?: { phaseBefore: BuildRunViewPhase; ok: boolean }
  readonly runCalls?: IRunFixCall[]
  readonly installCalls?: { count: number }
  readonly providerRunCalls?: Array<'codex' | 'opencode'>
  readonly providerUpdates?: Array<'codex' | 'opencode'>
}

/** A Build & Run store stub reporting a fixed phase for the re-run check. */
function fakeStore(phase: BuildRunViewPhase): IOpencodeReRunObserver {
  return {
    getStateForRepository: () => ({ phase, activeRunId: null }),
    onDidUpdate: () => new Disposable(() => {}),
    setPanelOpen: () => {},
    setPanelMinimized: () => {},
  }
}

function fakeDispatcher(options: IFakeDispatcherOptions): Dispatcher {
  return {
    detectOpencode: () => options.detect(),
    detectBuildFixProvider: () => options.detect(),
    installOpencode: async () => {
      if (options.installCalls) {
        options.installCalls.count++
      }
      options.onInstall?.()
      return { ok: true, code: 0 }
    },
    installBuildFixProvider: async () => {
      if (options.installCalls) {
        options.installCalls.count++
      }
      return { ok: true, code: 0 }
    },
    runOpencodeFix: async (
      _repository: Repository,
      request: IRunFixCall,
      _onLog: unknown,
      _signal?: AbortSignal
    ) => {
      options.runCalls?.push({
        autoApprove: request.autoApprove,
        stageKind: request.stageKind,
        cwd: request.cwd,
      })
      const result = options.runResult ?? {
        phaseBefore: 'failed' as BuildRunViewPhase,
        ok: true,
      }
      return {
        phaseBefore: result.phaseBefore,
        run: { ok: result.ok },
      }
    },
    runBuildFixProvider: async (
      provider: 'codex' | 'opencode',
      _repository: Repository,
      request: IRunFixCall
    ) => {
      options.providerRunCalls?.push(provider)
      options.runCalls?.push(request)
      return { phaseBefore: 'failed', run: { ok: true } }
    },
    updateRepositoryBuildRunPreferences: async (
      _repository: Repository,
      preferences: { buildFixProvider?: 'codex' | 'opencode' }
    ) => {
      if (preferences.buildFixProvider) {
        options.providerUpdates?.push(preferences.buildFixProvider)
      }
    },
  } as unknown as Dispatcher
}

function repository(
  autoApprove = false,
  buildFixProvider: 'codex' | 'opencode' = 'opencode'
) {
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
    {
      ...defaultBuildRunPreferences,
      buildFixProvider,
      buildFixAutoApprove: autoApprove,
      opencodeAutoApprove: autoApprove,
    }
  )
}

function renderDialog(
  overrides: Partial<IOpencodeFixDialogProps> & {
    readonly dispatcher: Dispatcher
  }
) {
  const props: IOpencodeFixDialogProps = {
    dispatcher: overrides.dispatcher,
    repository: overrides.repository ?? repository(),
    failure: overrides.failure ?? {
      stageKind: 'build',
      exitCode: 2,
      tailText: 'error: boom',
      cwd: 'C:/opencode-repo',
    },
    buildRunStore: overrides.buildRunStore ?? fakeStore('succeeded'),
    onDismissed: overrides.onDismissed ?? (() => {}),
  }
  return render(<OpencodeFixDialog {...props} />)
}

const installedAndAuthed = async () => ({
  installed: true,
  version: '1.2.3',
  authConfigured: true,
})

describe('OpencodeFixDialog', () => {
  it('offers the exact install command and installs when opencode is missing', async () => {
    const installCalls = { count: 0 }
    let detectCount = 0
    const dispatcher = fakeDispatcher({
      detect: async () => {
        detectCount++
        return detectCount === 1
          ? { installed: false, version: null, authConfigured: false }
          : { installed: true, version: '1.2.3', authConfigured: true }
      },
      installCalls,
    })

    renderDialog({ dispatcher })

    await screen.findByText(/npm i -g opencode-ai@latest/i)
    fireEvent.click(screen.getByRole('button', { name: /install opencode/i }))

    await waitFor(() => assert.equal(installCalls.count, 1))
    // After a successful install it re-detects and lands on the launch panel.
    await screen.findByRole('button', { name: /^run opencode$/i })
  })

  it('guides the user to authenticate and never launches when auth is missing', async () => {
    const runCalls: IRunFixCall[] = []
    const dispatcher = fakeDispatcher({
      detect: async () => ({
        installed: true,
        version: '1.2.3',
        authConfigured: false,
      }),
      runCalls,
    })

    renderDialog({ dispatcher })

    await screen.findByText(/opencode auth login/i)
    assert.equal(
      screen.queryByRole('button', { name: /^run opencode$/i }),
      null
    )
    assert.equal(runCalls.length, 0)
  })

  it('offers the exact official install command when Codex is missing', async () => {
    const installCalls = { count: 0 }
    let detectCount = 0
    const dispatcher = fakeDispatcher({
      detect: async () => {
        detectCount++
        return detectCount === 1
          ? { installed: false, version: null, authConfigured: false }
          : { installed: true, version: '0.144.0', authConfigured: true }
      },
      installCalls,
    })

    renderDialog({ dispatcher, repository: repository(false, 'codex') })

    await screen.findByText(/^npm install --global @openai\/codex$/i)
    await screen.findByText(/official @openai\/codex npm package/i)
    fireEvent.click(screen.getByRole('button', { name: /install codex/i }))

    await waitFor(() => assert.equal(installCalls.count, 1))
    await screen.findByRole('button', { name: /^run codex$/i })
  })

  it('guides Codex login without asking for a secret', async () => {
    const providerRunCalls: Array<'codex' | 'opencode'> = []
    const dispatcher = fakeDispatcher({
      detect: async () => ({
        installed: true,
        version: '0.144.0',
        authConfigured: false,
      }),
      providerRunCalls,
    })

    renderDialog({ dispatcher, repository: repository(false, 'codex') })

    await screen.findByText(/codex login/i)
    await screen.findByText(/never asks you to paste or store a secret/i)
    assert.equal(screen.queryByRole('button', { name: /^run codex$/i }), null)
    assert.equal(providerRunCalls.length, 0)
  })

  it('persists a Codex choice and launches the Codex provider path', async () => {
    const providerRunCalls: Array<'codex' | 'opencode'> = []
    const providerUpdates: Array<'codex' | 'opencode'> = []
    const dispatcher = fakeDispatcher({
      detect: installedAndAuthed,
      providerRunCalls,
      providerUpdates,
    })
    renderDialog({ dispatcher })

    const picker = await screen.findByLabelText<HTMLSelectElement>(
      /ai coding provider/i
    )
    fireEvent.change(picker, { target: { value: 'codex' } })
    fireEvent.click(await screen.findByRole('button', { name: /^run codex$/i }))

    await waitFor(() => assert.equal(providerRunCalls.length, 1))
    assert.deepEqual(providerRunCalls, ['codex'])
    assert.deepEqual(providerUpdates, ['codex'])
  })

  it('runs with auto-approve off by default and moves output to the build panel', async () => {
    const runCalls: IRunFixCall[] = []
    const dispatcher = fakeDispatcher({ detect: installedAndAuthed, runCalls })
    let dismissed = 0

    renderDialog({
      dispatcher,
      buildRunStore: fakeStore('succeeded'),
      onDismissed: () => dismissed++,
    })

    fireEvent.click(
      await screen.findByRole('button', { name: /^run opencode$/i })
    )

    await waitFor(() => assert.equal(dismissed, 1))
    assert.equal(runCalls.length, 1)
    assert.equal(runCalls[0].autoApprove, false)
    assert.equal(runCalls[0].stageKind, 'build')
  })

  it('passes auto-approve when the per-run toggle is enabled', async () => {
    const runCalls: IRunFixCall[] = []
    const dispatcher = fakeDispatcher({ detect: installedAndAuthed, runCalls })

    renderDialog({ dispatcher })

    await screen.findByRole('button', { name: /^run opencode$/i })
    fireEvent.click(
      screen.getByLabelText(/auto-approve opencode.s edits and commands/i)
    )
    fireEvent.click(screen.getByRole('button', { name: /^run opencode$/i }))

    await waitFor(() => assert.equal(runCalls.length, 1))
    assert.equal(runCalls[0].autoApprove, true)
  })

  it('reflects the repository auto-approve preference in the toggle and the run', async () => {
    const runCalls: IRunFixCall[] = []
    const dispatcher = fakeDispatcher({ detect: installedAndAuthed, runCalls })

    renderDialog({ dispatcher, repository: repository(true) })

    const toggle = await screen.findByLabelText<HTMLInputElement>(
      /auto-approve opencode.s edits and commands/i
    )
    assert.equal(toggle.checked, true)
    fireEvent.click(screen.getByRole('button', { name: /^run opencode$/i }))

    await waitFor(() => assert.equal(runCalls.length, 1))
    assert.equal(runCalls[0].autoApprove, true)
  })

  it('dismisses the launch dialog while a still-failing repair continues in the build panel', async () => {
    let dismissed = 0
    const dispatcher = fakeDispatcher({
      detect: installedAndAuthed,
      // opencode reports ok:true, but the re-run still fails — must not claim fixed.
      runResult: { phaseBefore: 'failed', ok: true },
    })

    renderDialog({
      dispatcher,
      buildRunStore: fakeStore('failed'),
      onDismissed: () => dismissed++,
    })

    fireEvent.click(
      await screen.findByRole('button', { name: /^run opencode$/i })
    )

    await waitFor(() => assert.equal(dismissed, 1))
  })
})
