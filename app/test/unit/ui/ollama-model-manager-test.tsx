import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'
import {
  OllamaModelManager,
  formatSafeOllamaEndpoint,
  type IOllamaManagerProvider,
  type IOllamaManagerProviderModel,
  type IOllamaModelInformation,
  type IOllamaModelManagerClient,
  type IOllamaModelRecord,
  type IOllamaPullOptions,
  type IOllamaRequestOptions,
  type IOllamaRunningModelRecord,
} from '../../../src/ui/copilot/ollama-model-manager'

interface IDeferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: Error) => void
}

function deferred<T>(): IDeferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function provider(
  id: string,
  models: ReadonlyArray<IOllamaManagerProviderModel> = []
): IOllamaManagerProvider {
  return {
    id,
    name: `Ollama ${id}`,
    baseUrl: `http://127.0.0.1:11434/${id}`,
    models,
  }
}

function providerModel(name: string): IOllamaManagerProviderModel {
  return { id: name, name }
}

class TestOllamaClient implements IOllamaModelManagerClient {
  public models: IOllamaModelRecord[]
  public runningModels: IOllamaRunningModelRecord[] = []
  public readonly calls: string[] = []
  public healthFails = false
  public inventoryFails = false
  public runningFails = false
  public pullGate: IDeferred<void> | null = null
  public copyGate: IDeferred<void> | null = null
  public listGate: IDeferred<ReadonlyArray<IOllamaModelRecord>> | null = null
  public lastListSignal: AbortSignal | undefined

  public constructor(models: ReadonlyArray<string>) {
    this.models = models.map(name => ({
      name,
      size: 3 * 1024 * 1024 * 1024,
      digest: `sha256:${name}`,
      modifiedAt: '2026-07-20T12:00:00.000Z',
      details: {
        family: 'llama',
        format: 'gguf',
        parameterSize: '3B',
        quantizationLevel: 'Q4_K_M',
      },
      capabilities: ['completion', 'tools'],
    }))
  }

  public async health(_options?: IOllamaRequestOptions) {
    this.calls.push('health')
    if (this.healthFails) {
      throw new Error('health failed')
    }
    return { version: '0.9.6' }
  }

  public async list(options?: IOllamaRequestOptions) {
    this.calls.push('list')
    this.lastListSignal = options?.signal
    if (this.inventoryFails) {
      throw new Error('inventory failed')
    }
    if (this.listGate !== null) {
      return this.listGate.promise
    }
    return [...this.models]
  }

  public async listRunning(_options?: IOllamaRequestOptions) {
    this.calls.push('listRunning')
    if (this.runningFails) {
      throw new Error('running failed')
    }
    return [...this.runningModels]
  }

  public async show(
    model: string,
    _options?: IOllamaRequestOptions
  ): Promise<IOllamaModelInformation> {
    this.calls.push(`show:${model}`)
    return {
      license: 'MIT',
      details: { family: 'llama', parameterSize: '3B' },
      capabilities: ['vision'],
    }
  }

  public async pull(model: string, options?: IOllamaPullOptions) {
    this.calls.push(`pull:${model}`)
    options?.onProgress?.({
      status: 'downloading',
      total: 100,
      completed: 40,
    })
    if (this.pullGate !== null) {
      await this.pullGate.promise
    }
    this.models.push({ name: model })
  }

  public async copy(
    source: string,
    destination: string,
    _options?: IOllamaRequestOptions
  ) {
    this.calls.push(`copy:${source}:${destination}`)
    if (this.copyGate !== null) {
      await this.copyGate.promise
    }
    this.models.push({ name: destination })
  }

  public async delete(model: string, _options?: IOllamaRequestOptions) {
    this.calls.push(`delete:${model}`)
    this.models = this.models.filter(item => item.name !== model)
  }

  public async load(model: string, _options?: IOllamaRequestOptions) {
    this.calls.push(`load:${model}`)
    this.runningModels = [{ name: model, sizeVram: 1024, contextLength: 4096 }]
  }

  public async unload(model: string, _options?: IOllamaRequestOptions) {
    this.calls.push(`unload:${model}`)
    this.runningModels = this.runningModels.filter(item => item.name !== model)
  }
}

function renderManager(
  configuredProvider: IOllamaManagerProvider,
  client: IOllamaModelManagerClient,
  onProviderModelsChanged: (
    provider: IOllamaManagerProvider,
    models: ReadonlyArray<IOllamaManagerProviderModel>
  ) => Promise<void> | void = () => {}
) {
  return render(
    <OllamaModelManager
      provider={configuredProvider}
      client={client}
      onProviderModelsChanged={onProviderModelsChanged}
    />
  )
}

function verification(
  container: HTMLElement,
  value: string
): HTMLElement | null {
  return container.querySelector(`[data-verification="${value}"]`)
}

function InlineFactoryHarness(props: {
  readonly client: IOllamaModelManagerClient
}) {
  const [configuredProvider, setConfiguredProvider] = React.useState(
    provider('inline-factory', [providerModel('legacy')])
  )
  return (
    <OllamaModelManager
      provider={configuredProvider}
      clientFactory={() => props.client}
      onProviderModelsChanged={(current, models) => {
        setConfiguredProvider({ ...current, models })
      }}
    />
  )
}

describe('OllamaModelManager', () => {
  it('renders loading, reachable inventory, runtime metadata, and authoritative sync', async () => {
    const client = new TestOllamaClient(['alpha'])
    client.runningModels = [
      {
        name: 'alpha',
        sizeVram: 1024,
        contextLength: 4096,
        expiresAt: '2026-07-20T13:00:00.000Z',
      },
    ]
    const changes: Array<{
      providerId: string
      models: ReadonlyArray<IOllamaManagerProviderModel>
    }> = []

    const view = renderManager(
      provider('one', [providerModel('legacy')]),
      client,
      (p, models) => {
        changes.push({ providerId: p.id, models })
      }
    )

    const manager = view.container.querySelector('.ollama-model-manager')
    assert.ok(manager instanceof HTMLElement)
    assert.strictEqual(manager.getAttribute('aria-busy'), 'true')
    assert.ok(screen.getByText('Loading models…'))

    await waitFor(() => assert.ok(screen.getByText('Connected')))
    await waitFor(() => assert.ok(screen.getByText('MIT')))

    assert.strictEqual(manager.getAttribute('aria-busy'), 'false')
    assert.ok(
      view.container.textContent?.includes('http://127.0.0.1:11434/one')
    )
    assert.ok(screen.getByText('0.9.6'))
    assert.ok(screen.getByRole('button', { name: 'Select alpha' }))
    assert.ok(screen.getAllByText('Running').length >= 2)
    for (const hook of [
      'ollama-manager',
      'ollama-refresh',
      'ollama-endpoint-status',
      'ollama-pull-name',
      'ollama-pull',
      'ollama-filter',
      'ollama-scope',
      'ollama-inventory',
      'ollama-model-row',
      'ollama-details',
      'ollama-load',
      'ollama-unload',
      'ollama-delete',
      'ollama-copy-name',
      'ollama-copy',
    ]) {
      assert.ok(verification(view.container, hook), `missing ${hook}`)
    }
    assert.strictEqual(
      verification(view.container, 'ollama-model-row')?.dataset.model,
      'alpha'
    )
    assert.deepStrictEqual(changes, [
      { providerId: 'one', models: [providerModel('alpha')] },
    ])
  })

  it('scrubs private endpoint parts and falls back for malformed values', async () => {
    const privateProvider: IOllamaManagerProvider = {
      ...provider('private', [providerModel('alpha')]),
      baseUrl:
        'http://username:password@127.0.0.1:11434/v1?token=secret#private',
    }
    const view = renderManager(privateProvider, new TestOllamaClient(['alpha']))

    await waitFor(() => assert.ok(screen.getByText('Connected')))
    assert.match(
      view.container.textContent ?? '',
      /http:\/\/127\.0\.0\.1:11434\/v1/
    )
    assert.doesNotMatch(
      view.container.textContent ?? '',
      /username|password|token|secret|#private/
    )
    assert.strictEqual(
      formatSafeOllamaEndpoint('not a URL', 'Configured endpoint'),
      'Configured endpoint'
    )
  })

  it('does not reset when persistence rerenders an equivalent inline factory', async () => {
    const client = new TestOllamaClient(['alpha'])
    render(<InlineFactoryHarness client={client} />)

    await waitFor(() => assert.ok(screen.getByText('MIT')))
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.strictEqual(client.calls.filter(call => call === 'list').length, 1)
    assert.strictEqual(client.calls.filter(call => call === 'health').length, 1)
  })

  it('renders empty, partial, and unavailable inventory states without syncing failed inventory', async () => {
    const emptyClient = new TestOllamaClient([])
    const emptyChanges: string[] = []
    const emptyView = renderManager(provider('empty'), emptyClient, p => {
      emptyChanges.push(p.id)
    })
    await waitFor(() =>
      assert.ok(screen.getByText('No models are installed on this endpoint.'))
    )
    assert.deepStrictEqual(emptyChanges, [])
    emptyView.unmount()

    const partialClient = new TestOllamaClient(['partial-model'])
    partialClient.runningFails = true
    const partialChanges: string[] = []
    const partialView = renderManager(provider('partial'), partialClient, p => {
      partialChanges.push(p.id)
    })
    await waitFor(() =>
      assert.ok(screen.getByText('Some model information could not be loaded.'))
    )
    assert.ok(screen.getByRole('button', { name: 'Select partial-model' }))
    assert.strictEqual(screen.queryByRole('alert'), null)
    assert.deepStrictEqual(partialChanges, ['partial'])
    partialView.unmount()

    const unavailableClient = new TestOllamaClient(['must-not-sync'])
    unavailableClient.healthFails = true
    unavailableClient.inventoryFails = true
    unavailableClient.runningFails = true
    const unavailableChanges: string[] = []
    renderManager(provider('unavailable'), unavailableClient, p => {
      unavailableChanges.push(p.id)
    })
    await waitFor(() =>
      assert.ok(screen.getByText('The model inventory is unavailable.'))
    )
    assert.ok(screen.getByRole('alert'))
    assert.deepStrictEqual(unavailableChanges, [])
  })

  it('never treats a failed inventory request as a provider model sync source', async () => {
    const client = new TestOllamaClient(['server-model'])
    client.inventoryFails = true
    const changes: string[] = []
    renderManager(
      provider('failed', [providerModel('configured-model')]),
      client,
      p => {
        changes.push(p.id)
      }
    )

    await waitFor(() =>
      assert.ok(screen.getByText('Some model information could not be loaded.'))
    )
    assert.deepStrictEqual(changes, [])
  })

  it('removes stale actions when a later inventory refresh fails', async () => {
    const client = new TestOllamaClient(['alpha'])
    const changes: string[] = []
    renderManager(
      provider('refresh-failure', [providerModel('alpha')]),
      client,
      p => {
        changes.push(p.id)
      }
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Select alpha' }))
    )

    client.inventoryFails = true
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() =>
      assert.ok(screen.getByText('The model inventory is unavailable.'))
    )

    assert.strictEqual(
      screen.queryByRole('button', { name: 'Select alpha' }),
      null
    )
    assert.strictEqual(screen.queryByRole('button', { name: 'Delete' }), null)
    assert.deepStrictEqual(changes, [])
  })

  it('aborts and drops an inventory response from a replaced client', async () => {
    const staleClient = new TestOllamaClient(['stale-model'])
    const staleInventory = deferred<ReadonlyArray<IOllamaModelRecord>>()
    staleClient.listGate = staleInventory
    const currentClient = new TestOllamaClient(['current-model'])
    const configuredProvider = provider('rotated-client')
    const view = renderManager(configuredProvider, staleClient)
    await waitFor(() => assert.ok(staleClient.lastListSignal))

    view.rerender(
      <OllamaModelManager
        provider={configuredProvider}
        client={currentClient}
        onProviderModelsChanged={() => {}}
      />
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Select current-model' }))
    )
    assert.strictEqual(staleClient.lastListSignal?.aborted, true)
    staleInventory.resolve(staleClient.models)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.strictEqual(
      screen.queryByRole('button', { name: 'Select stale-model' }),
      null
    )
  })

  it('runs pull, copy, rename, load, unload, and confirmed delete through refreshed inventory', async () => {
    const client = new TestOllamaClient(['alpha'])
    const synchronized: Array<ReadonlyArray<string>> = []
    const view = renderManager(
      provider('lifecycle', [providerModel('alpha')]),
      client,
      (_p, models) => {
        synchronized.push(models.map(model => model.id))
      }
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Select alpha' }))
    )

    fireEvent.change(screen.getByLabelText('Model name'), {
      target: { value: 'beta' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pull and install' }))
    await waitFor(() => assert.ok(screen.getByText('Installed beta.')))

    fireEvent.change(screen.getByLabelText('Copy destination'), {
      target: { value: 'gamma' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => assert.ok(screen.getByText('Copied alpha to gamma.')))

    fireEvent.change(screen.getByLabelText('New model name'), {
      target: { value: 'delta' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await waitFor(() => assert.ok(screen.getByText('Renamed alpha to delta.')))

    fireEvent.click(screen.getByRole('button', { name: 'Load / start' }))
    await waitFor(() => assert.ok(screen.getByText('Loaded beta.')))
    fireEvent.click(screen.getByRole('button', { name: 'Unload / stop' }))
    await waitFor(() => assert.ok(screen.getByText('Unloaded beta.')))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    let confirmation = screen.getByRole('alertdialog')
    assert.ok(verification(view.container, 'ollama-delete-dialog'))
    assert.ok(verification(view.container, 'ollama-delete-confirm'))
    assert.ok(verification(view.container, 'ollama-delete-cancel'))
    const confirmButton = within(confirmation).getByRole('button', {
      name: 'Delete model',
    })
    assert.strictEqual(document.activeElement, confirmButton)
    fireEvent.keyDown(confirmButton, { key: 'Escape' })
    assert.strictEqual(screen.queryByRole('alertdialog'), null)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    confirmation = screen.getByRole('alertdialog')
    fireEvent.click(
      within(confirmation).getByRole('button', { name: 'Delete model' })
    )
    await waitFor(() => assert.ok(screen.getByText('Deleted beta.')))

    assert.deepStrictEqual(
      client.calls.filter(call =>
        /^(pull|copy|delete|load|unload):/.test(call)
      ),
      [
        'pull:beta',
        'copy:alpha:gamma',
        'copy:alpha:delta',
        'delete:alpha',
        'load:beta',
        'unload:beta',
        'delete:beta',
      ]
    )
    assert.deepStrictEqual(synchronized[synchronized.length - 1], [
      'gamma',
      'delta',
    ])
  })

  it('does not bubble editor submissions to the parent dialog form', async () => {
    const client = new TestOllamaClient(['alpha'])
    let parentSubmissions = 0
    render(
      <div
        onSubmit={event => {
          event.preventDefault()
          parentSubmissions++
        }}
      >
        <OllamaModelManager
          provider={provider('nested', [providerModel('alpha')])}
          client={client}
          onProviderModelsChanged={() => {}}
        />
      </div>
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Select alpha' }))
    )

    fireEvent.change(screen.getByLabelText('Model name'), {
      target: { value: 'beta' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pull and install' }))
    await waitFor(() => assert.ok(screen.getByText('Installed beta.')))

    fireEvent.change(screen.getByLabelText('Copy destination'), {
      target: { value: 'gamma' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => assert.ok(screen.getByText('Copied alpha to gamma.')))

    fireEvent.change(screen.getByLabelText('New model name'), {
      target: { value: 'delta' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    await waitFor(() => assert.ok(screen.getByText('Renamed alpha to delta.')))

    assert.strictEqual(parentSubmissions, 0)
  })

  it('cancels a pull without accepting its late completion or persisting phantom models', async () => {
    const client = new TestOllamaClient(['alpha'])
    const gate = deferred<void>()
    client.pullGate = gate
    const changes: string[] = []
    const view = renderManager(
      provider('cancel', [providerModel('alpha')]),
      client,
      p => {
        changes.push(p.id)
      }
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Select alpha' }))
    )

    fireEvent.change(screen.getByLabelText('Model name'), {
      target: { value: 'late-model' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pull and install' }))
    const progress = (await screen.findByRole('progressbar', {
      name: 'Receiving model data…',
    })) as HTMLProgressElement
    assert.strictEqual(progress.value, 40)
    assert.strictEqual(progress.max, 100)
    assert.ok(verification(view.container, 'ollama-pull-progress'))
    assert.ok(verification(view.container, 'ollama-pull-cancel'))
    assert.strictEqual(
      screen
        .getByRole('heading', { name: 'Ollama model manager' })
        .closest('section')
        ?.getAttribute('aria-busy'),
      'true'
    )
    assert.strictEqual(
      (screen.getByLabelText('Copy destination') as HTMLInputElement).disabled,
      true
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.ok(screen.getByText('Model installation canceled.'))

    gate.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepStrictEqual(changes, [])
    assert.strictEqual(screen.queryByText('Installed late-model.'), null)
  })

  it('recovers inventory when pull cancellation races the post-pull refresh', async () => {
    const client = new TestOllamaClient(['alpha'])
    renderManager(provider('cancel-refresh', [providerModel('alpha')]), client)
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Select alpha' }))
    )

    const postPullInventory = deferred<ReadonlyArray<IOllamaModelRecord>>()
    client.listGate = postPullInventory
    fireEvent.change(screen.getByLabelText('Model name'), {
      target: { value: 'beta' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Pull and install' }))
    await waitFor(() =>
      assert.strictEqual(client.calls.filter(call => call === 'list').length, 2)
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    postPullInventory.resolve([...client.models])

    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Refresh' }))
    )
    assert.ok(screen.getByText('Model installation canceled.'))
    assert.ok(screen.getByRole('button', { name: 'Select beta' }))
  })

  it('does not write a late operation result into a newly selected provider', async () => {
    const clientA = new TestOllamaClient(['alpha'])
    const copyGate = deferred<void>()
    clientA.copyGate = copyGate
    const clientB = new TestOllamaClient(['beta'])
    const changes: string[] = []
    const providerA = provider('a', [providerModel('alpha')])
    const providerB = provider('b', [providerModel('beta')])
    const view = renderManager(providerA, clientA, p => {
      changes.push(p.id)
    })
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Select alpha' }))
    )

    fireEvent.change(screen.getByLabelText('Copy destination'), {
      target: { value: 'late-copy' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() =>
      assert.ok(clientA.calls.includes('copy:alpha:late-copy'))
    )

    view.rerender(
      <OllamaModelManager
        provider={providerB}
        client={clientB}
        onProviderModelsChanged={p => {
          changes.push(p.id)
        }}
      />
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('button', { name: 'Select beta' }))
    )
    copyGate.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.deepStrictEqual(changes, [])
    assert.strictEqual(screen.queryByText('Copied alpha to late-copy.'), null)
    assert.ok(screen.getByText('Ollama b · http://127.0.0.1:11434/b'))
  })

  it('reports a persistence failure without converting it into operation failure', async () => {
    const client = new TestOllamaClient(['authoritative'])
    const view = renderManager(provider('persistence'), client, async () => {
      throw new Error('write failed')
    })

    await waitFor(() =>
      assert.ok(
        screen.getByText(
          'The Ollama operation succeeded, but the configured model list could not be updated.'
        )
      )
    )
    assert.ok(verification(view.container, 'ollama-notice'))
    assert.ok(screen.getByRole('button', { name: 'Select authoritative' }))
  })
})
