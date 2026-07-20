import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'
import { ipcRenderer } from 'electron'

import type { IBYOKProvider } from '../../../src/lib/copilot/byok'
import { EditCopilotBYOKProviderDialog } from '../../../src/ui/copilot/edit-byok-provider-dialog'
import type { Dispatcher } from '../../../src/ui/dispatcher'
import { fireEvent, render, screen } from '../../helpers/ui/render'

const dispatcher = {} as Dispatcher
let previousSend: typeof ipcRenderer.send

beforeEach(() => {
  previousSend = ipcRenderer.send
  ipcRenderer.send = () => undefined
})

afterEach(() => {
  ipcRenderer.send = previousSend
  localStorage.clear()
})

describe('EditCopilotBYOKProviderDialog Ollama preset', () => {
  it('creates a credential-free Ollama provider before models are installed', () => {
    const saved = new Array<{
      readonly provider: IBYOKProvider
      readonly secret: string | null | undefined
    }>()

    render(
      <EditCopilotBYOKProviderDialog
        dispatcher={dispatcher}
        provider={null}
        onSave={(provider, secret) => saved.push({ provider, secret })}
        onDismissed={() => {}}
      />
    )

    fireEvent.change(screen.getByLabelText('Type'), {
      target: { value: 'ollama' },
    })

    assert.strictEqual(
      (screen.getByLabelText('Name') as HTMLInputElement).value,
      'Ollama'
    )
    assert.strictEqual(
      (screen.getByLabelText('Base URL') as HTMLInputElement).value,
      'http://127.0.0.1:11434/v1'
    )
    assert.ok(screen.getByText(/native management API/i))
    assert.strictEqual(screen.queryByLabelText('Authentication'), null)
    assert.strictEqual(
      screen.queryByRole('button', { name: 'Add model…' }),
      null
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add', hidden: true }))

    assert.strictEqual(saved.length, 1)
    assert.deepStrictEqual(saved[0].provider, {
      id: saved[0].provider.id,
      name: 'Ollama',
      type: 'openai',
      baseUrl: 'http://127.0.0.1:11434/v1',
      authKind: 'none',
      models: [],
      wireApi: 'completions',
      integration: 'ollama',
    })
    assert.strictEqual(saved[0].secret, null)
  })

  it('recognizes an existing provider by its durable integration marker', () => {
    const provider: IBYOKProvider = {
      id: 'ollama-provider',
      name: 'Local models',
      type: 'openai',
      baseUrl: 'http://localhost:11434/v1',
      wireApi: 'completions',
      authKind: 'none',
      integration: 'ollama',
      models: [{ id: 'granite-code:8b', name: 'Granite Code 8B' }],
    }

    render(
      <EditCopilotBYOKProviderDialog
        dispatcher={dispatcher}
        provider={provider}
        onSave={() => {}}
        onDismissed={() => {}}
      />
    )

    assert.strictEqual(
      (screen.getByLabelText('Type') as HTMLSelectElement).value,
      'ollama'
    )
    assert.ok(screen.getByText('Granite Code 8B'))
  })
})
