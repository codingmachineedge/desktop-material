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
  onRefreshRepository = async () => {},
  chooseArchiveDestination?: (
    format: 'zip' | 'tar',
    defaultPath: string
  ) => Promise<string | null>,
  revealArchive?: (path: string) => Promise<void>,
  chooseBundleDestination?: (defaultPath: string) => Promise<string | null>
) {
  return render(
    <RepositoryTools
      repositoryPath="C:/repo"
      onRefreshRepository={onRefreshRepository}
      client={client}
      chooseArchiveDestination={chooseArchiveDestination}
      revealArchive={revealArchive}
      chooseBundleDestination={chooseBundleDestination}
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
    assert.ok(screen.getByText('Audit recent commit signatures'))
    assert.ok(screen.getByText('Preview maintenance needs'))
    assert.ok(screen.getByText('Run repository maintenance'))
    assert.ok(screen.getByText('View recent ref movements'))
    assert.ok(screen.getByText('Export repository artifacts'))
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

  it('exports HEAD through a guided save, confirmation, and reveal flow', async () => {
    const client = new FakeRepositoryToolsClient()
    const choices: Array<{ format: string; defaultPath: string }> = []
    const revealed: string[] = []
    renderTools(
      client,
      async () => {},
      async (format, defaultPath) => {
        choices.push({ format, defaultPath })
        return 'C:/exports/repository-source'
      },
      async path => {
        revealed.push(path)
      }
    )
    await screen.findByText('git version 2.55.0')

    fireEvent.click(screen.getByRole('button', { name: 'Export ZIP' }))
    await screen.findByRole('alertdialog')
    assert.equal(choices.length, 1)
    assert.equal(choices[0].format, 'zip')
    assert.match(choices[0].defaultPath, /repo\.zip$/)
    assert.match(
      screen.getByText(/Destination:/).textContent ?? '',
      /repository-source\.zip/
    )
    assert.equal(client.starts.length, 0)

    fireEvent.click(screen.getByRole('button', { name: 'Export archive' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].args, [
      'archive',
      '--format=zip',
      '--output=C:\\exports\\repository-source.zip',
      'HEAD',
    ])
    assert.equal(client.starts[0].confirmed, true)

    const id = client.starts[0].id
    client.emitState({
      id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await screen.findByRole('button', { name: 'Show in folder' })
    assert.match(
      screen.getByLabelText('Repository tool results').textContent ?? '',
      /repository-source\.zip/
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }))
    await waitFor(() =>
      assert.deepStrictEqual(revealed, ['C:\\exports\\repository-source.zip'])
    )
  })

  it('exports all local refs through a guided full-history bundle flow', async () => {
    const client = new FakeRepositoryToolsClient()
    const defaults: string[] = []
    renderTools(
      client,
      async () => {},
      undefined,
      undefined,
      async defaultPath => {
        defaults.push(defaultPath)
        return 'C:/exports/all-history'
      }
    )
    await screen.findByText('git version 2.55.0')

    fireEvent.click(
      screen.getByRole('button', { name: 'Export full-history bundle' })
    )
    await screen.findByRole('alertdialog')
    assert.match(defaults[0], /repo\.bundle$/)
    assert.match(
      screen.getByText(/Destination:/).textContent ?? '',
      /all-history\.bundle/
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export bundle' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].args, [
      'bundle',
      'create',
      'C:\\exports\\all-history.bundle',
      '--all',
    ])
    assert.equal(client.starts[0].confirmed, true)
  })
})
