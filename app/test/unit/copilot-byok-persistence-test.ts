import assert from 'node:assert'
import { describe, it } from 'node:test'

import type { IBYOKProvider } from '../../src/lib/copilot/byok'
import { AppStore } from '../../src/lib/stores/app-store'
import { Dispatcher } from '../../src/ui/dispatcher/dispatcher'

const existingProvider: IBYOKProvider = {
  id: 'ollama-local',
  name: 'Ollama',
  type: 'openai',
  integration: 'ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  wireApi: 'completions',
  authKind: 'none',
  models: [{ id: 'material-chat:7b', name: 'material-chat:7b' }],
}

function createDispatcher(update: () => Promise<void>): Dispatcher {
  const dispatcher = new Dispatcher(
    { _updateCopilotBYOKProvider: update } as never,
    {} as never,
    { increment: () => {} } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  )
  dispatcher.registerErrorHandler(async () => null)
  return dispatcher
}

describe('Copilot BYOK provider persistence', () => {
  it('reports dispatcher update success and failure to its caller', async () => {
    const expectedError = new Error('storage unavailable')
    const successful = createDispatcher(async () => {})
    const failing = createDispatcher(async () => {
      throw expectedError
    })

    assert.equal(
      await successful.updateCopilotBYOKProvider(existingProvider, undefined),
      true
    )
    assert.equal(
      await failing.updateCopilotBYOKProvider(existingProvider, undefined),
      false
    )
  })

  it('does not mutate in-memory providers when serialization fails', async () => {
    const replacement = {
      ...existingProvider,
      name: 'Updated Ollama',
    } as IBYOKProvider & { circular?: unknown }
    replacement.circular = replacement
    let scrubbed = false
    let emitted = false
    const store = {
      byokProviders: [existingProvider],
      scrubMissingCopilotModelSelections: () => {
        scrubbed = true
      },
      emitUpdate: () => {
        emitted = true
      },
    }

    await assert.rejects(
      AppStore.prototype._updateCopilotBYOKProvider.call(
        store as never,
        replacement,
        undefined
      ),
      /circular/i
    )
    assert.deepEqual(store.byokProviders, [existingProvider])
    assert.equal(scrubbed, false)
    assert.equal(emitted, false)
  })
})
