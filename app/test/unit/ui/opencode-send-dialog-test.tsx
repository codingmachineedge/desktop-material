import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'
import { Repository } from '../../../src/models/repository'
import { defaultBuildRunPreferences } from '../../../src/models/build-run-preferences'
import { Dispatcher } from '../../../src/ui/dispatcher'
import {
  IOpencodePanelController,
  IOpencodeSendDialogProps,
  OpencodeSendDialog,
} from '../../../src/ui/build-run/opencode-send-dialog'
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

interface IRunPromptCall {
  readonly prompt: string
  readonly autoApprove: boolean
  readonly cwd: string
}

interface IFakeDispatcherOptions {
  readonly detect: () => Promise<{
    installed: boolean
    version: string | null
    authConfigured: boolean
  }>
  readonly runCalls?: IRunPromptCall[]
  readonly installCalls?: { count: number }
}

function fakePanel(): IOpencodePanelController & { openCalls: number } {
  const controller = {
    openCalls: 0,
    setPanelOpen: () => {
      controller.openCalls++
    },
    setPanelMinimized: () => {},
  }
  return controller
}

function fakeDispatcher(options: IFakeDispatcherOptions): Dispatcher {
  return {
    detectOpencode: () => options.detect(),
    installOpencode: async () => {
      if (options.installCalls) {
        options.installCalls.count++
      }
      return { ok: true, code: 0 }
    },
    runOpencodePrompt: async (
      _repository: Repository,
      request: IRunPromptCall,
      _onLog: unknown,
      _signal?: AbortSignal
    ) => {
      options.runCalls?.push({
        prompt: request.prompt,
        autoApprove: request.autoApprove,
        cwd: request.cwd,
      })
      return { ok: true }
    },
  } as unknown as Dispatcher
}

function repository(opencodeAutoApprove = false) {
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
      opencodeAutoApprove,
    }
  )
}

function renderDialog(
  overrides: Partial<IOpencodeSendDialogProps> & {
    readonly dispatcher: Dispatcher
  }
) {
  const props: IOpencodeSendDialogProps = {
    dispatcher: overrides.dispatcher,
    repository: overrides.repository ?? repository(),
    context: overrides.context ?? { cwd: 'C:/opencode-repo' },
    buildRunStore: overrides.buildRunStore ?? fakePanel(),
    onDismissed: overrides.onDismissed ?? (() => {}),
  }
  return render(<OpencodeSendDialog {...props} />)
}

const installedAndAuthed = async () => ({
  installed: true,
  version: '1.2.3',
  authConfigured: true,
})

function promptBox(): HTMLTextAreaElement {
  return screen.getByLabelText<HTMLTextAreaElement>(/what should opencode do/i)
}

describe('OpencodeSendDialog', () => {
  it('disables Send until a non-empty prompt is typed', async () => {
    const dispatcher = fakeDispatcher({ detect: installedAndAuthed })
    renderDialog({ dispatcher })

    const send = await screen.findByRole('button', {
      name: /send to opencode/i,
    })
    assert.equal(send.getAttribute('aria-disabled'), 'true')

    fireEvent.change(promptBox(), { target: { value: 'Add a README' } })
    assert.equal(
      screen
        .getByRole('button', { name: /send to opencode/i })
        .getAttribute('aria-disabled'),
      null
    )
  })

  it('sends the typed prompt via runOpencodePrompt, auto-approve off by default', async () => {
    const runCalls: IRunPromptCall[] = []
    const dispatcher = fakeDispatcher({ detect: installedAndAuthed, runCalls })
    let dismissed = 0
    const panel = fakePanel()

    renderDialog({
      dispatcher,
      buildRunStore: panel,
      onDismissed: () => dismissed++,
    })

    await screen.findByRole('button', { name: /send to opencode/i })
    fireEvent.change(promptBox(), { target: { value: 'Add a health check' } })
    fireEvent.click(screen.getByRole('button', { name: /send to opencode/i }))

    await waitFor(() => assert.equal(runCalls.length, 1))
    assert.equal(runCalls[0].prompt, 'Add a health check')
    assert.equal(runCalls[0].autoApprove, false)
    assert.equal(runCalls[0].cwd, 'C:/opencode-repo')
    // The run detaches to the Build & Run panel.
    assert.equal(dismissed, 1)
    assert.ok(panel.openCalls >= 1)
  })

  it('never sends when the prompt is only whitespace', async () => {
    const runCalls: IRunPromptCall[] = []
    const dispatcher = fakeDispatcher({ detect: installedAndAuthed, runCalls })
    renderDialog({ dispatcher })

    await screen.findByRole('button', { name: /send to opencode/i })
    fireEvent.change(promptBox(), { target: { value: '    ' } })
    // The button stays disabled; force a submit to prove the guard rejects it.
    const form = promptBox().closest('form')
    if (form) {
      fireEvent.submit(form)
    }

    assert.equal(runCalls.length, 0)
  })

  it('passes auto-approve when the per-run toggle is enabled', async () => {
    const runCalls: IRunPromptCall[] = []
    const dispatcher = fakeDispatcher({ detect: installedAndAuthed, runCalls })
    renderDialog({ dispatcher })

    await screen.findByRole('button', { name: /send to opencode/i })
    fireEvent.change(promptBox(), { target: { value: 'do it' } })
    fireEvent.click(
      screen.getByLabelText(/auto-approve opencode.s edits and commands/i)
    )
    fireEvent.click(screen.getByRole('button', { name: /send to opencode/i }))

    await waitFor(() => assert.equal(runCalls.length, 1))
    assert.equal(runCalls[0].autoApprove, true)
  })

  it('seeds the prompt from the provided initial prompt', async () => {
    const dispatcher = fakeDispatcher({ detect: installedAndAuthed })
    renderDialog({
      dispatcher,
      context: { cwd: 'C:/opencode-repo', initialPrompt: 'seeded message' },
    })

    await screen.findByRole('button', { name: /send to opencode/i })
    assert.equal(promptBox().value, 'seeded message')
  })

  it('guides the user to authenticate and never runs when auth is missing', async () => {
    const runCalls: IRunPromptCall[] = []
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
      screen.queryByRole('button', { name: /send to opencode/i }),
      null
    )
    assert.equal(runCalls.length, 0)
  })

  it('offers the exact install command when opencode is missing', async () => {
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
    await screen.findByRole('button', { name: /send to opencode/i })
  })
})
