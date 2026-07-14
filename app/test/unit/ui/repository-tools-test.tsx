import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as React from 'react'
import {
  ICLICommandOutputEvent,
  ICLICommandRequest,
  ICLICommandStateEvent,
  ICLIWorkbenchCatalog,
} from '../../../src/lib/cli-workbench'
import {
  IRepositoryToolsClient,
  RepositoryTools,
} from '../../../src/ui/repository-tools'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const catalog: ICLIWorkbenchCatalog = {
  tools: [
    {
      tool: 'git',
      available: true,
      version: 'git version 2.55.0',
      error: null,
      entries: [],
    },
    {
      tool: 'gh',
      available: true,
      version: 'gh version 2.80.0',
      error: null,
      entries: [],
    },
  ],
  entries: [],
}

class FakeRepositoryToolsClient implements IRepositoryToolsClient {
  public readonly starts: ICLICommandRequest[] = []
  public readonly cancels: string[] = []
  private readonly outputHandlers = new Set<
    (event: ICLICommandOutputEvent) => void
  >()
  private readonly stateHandlers = new Set<
    (event: ICLICommandStateEvent) => void
  >()

  public getCatalog = async () => catalog
  public start = async (request: ICLICommandRequest) => {
    this.starts.push(request)
  }
  public cancel = async (id: string) => {
    this.cancels.push(id)
    return true
  }
  public onOutput = (handler: (event: ICLICommandOutputEvent) => void) => {
    this.outputHandlers.add(handler)
    return () => this.outputHandlers.delete(handler)
  }
  public onState = (handler: (event: ICLICommandStateEvent) => void) => {
    this.stateHandlers.add(handler)
    return () => this.stateHandlers.delete(handler)
  }
  public emitOutput(event: ICLICommandOutputEvent) {
    this.outputHandlers.forEach(handler => handler(event))
  }
  public emitState(event: ICLICommandStateEvent) {
    this.stateHandlers.forEach(handler => handler(event))
  }
}

function renderTools(
  client: FakeRepositoryToolsClient,
  onRefreshRepository = async () => {}
) {
  return render(
    <RepositoryTools
      repositoryPath="C:/repo"
      onRefreshRepository={onRefreshRepository}
      client={client}
    />
  )
}

describe('Repository tools', () => {
  it('renders named functions without raw command, search, or terminal inputs', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')

    assert.ok(screen.getByText('Status summary'))
    assert.ok(screen.getByText('Repository health check'))
    assert.ok(screen.getByText('Preview maintenance needs'))
    assert.ok(screen.getByText('Run repository maintenance'))
    assert.ok(screen.getByText('View recent ref movements'))
    assert.equal(screen.queryByRole('searchbox'), null)
    assert.equal(screen.queryByRole('textbox'), null)
    assert.equal(screen.queryByText(/command arguments/i), null)
  })

  it('runs a status summary through its fixed recipe', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')

    const card = screen.getByText('Status summary').closest('article')
    assert.ok(card)
    fireEvent.click(card.querySelector('button') as HTMLButtonElement)
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0], {
      id: client.starts[0].id,
      tool: 'git',
      args: ['status', '--short', '--branch'],
      cwd: 'C:/repo',
      confirmed: false,
    })
  })

  it('keeps reflog inspection non-mutating and shell-free', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')

    const card = screen
      .getByText('View recent ref movements')
      .closest('article')
    assert.ok(card)
    fireEvent.click(card.querySelector('button') as HTMLButtonElement)
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].args, [
      'reflog',
      'show',
      '--date=local',
      '-50',
    ])
    assert.equal(client.starts[0].confirmed, false)
  })

  it('requires an explicit maintenance confirmation and refreshes on success', async () => {
    const client = new FakeRepositoryToolsClient()
    let refreshes = 0
    renderTools(client, async () => {
      refreshes++
    })
    await screen.findByText('git version 2.55.0')

    fireEvent.click(screen.getByRole('button', { name: 'Review and run' }))
    assert.equal(client.starts.length, 0)
    assert.ok(screen.getByRole('alertdialog'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm maintenance' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].args, ['maintenance', 'run'])
    assert.equal(client.starts[0].confirmed, true)

    const id = client.starts[0].id
    client.emitState({
      id,
      state: 'running',
      exitCode: null,
      signal: null,
    })
    client.emitOutput({ id, stream: 'stdout', data: 'maintenance complete\n' })
    client.emitState({
      id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(refreshes, 1))
    assert.match(
      screen.getByLabelText('Repository tool results').textContent ?? '',
      /maintenance complete/
    )
  })

  it('streams diagnostics into one buffer and cancels the exact run', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(client)
    await screen.findByText('git version 2.55.0')

    const card = screen.getByText('Repository health check').closest('article')
    assert.ok(card)
    fireEvent.click(card.querySelector('button') as HTMLButtonElement)
    await waitFor(() => assert.equal(client.starts.length, 1))
    const id = client.starts[0].id
    client.emitState({
      id,
      state: 'running',
      exitCode: null,
      signal: null,
    })
    client.emitOutput({ id, stream: 'stderr', data: 'dangling object\n' })
    assert.match(
      screen.getByLabelText('Repository tool results').textContent ?? '',
      /\[diagnostic\] dangling object/
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => assert.deepStrictEqual(client.cancels, [id]))
  })
})
