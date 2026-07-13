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
  IRepositoryBundleImportRequest,
  IRepositoryToolsClient,
  prepareRepositoryBundleImport,
  RepositoryBundleImport,
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
  chooseBundleDestination?: (defaultPath: string) => Promise<string | null>,
  chooseBundleToVerify?: () => Promise<string | null>,
  chooseBundleToImport?: () => Promise<string | null>
) {
  return render(
    <RepositoryTools
      repositoryPath="C:/repo"
      onRefreshRepository={onRefreshRepository}
      client={client}
      chooseArchiveDestination={chooseArchiveDestination}
      revealArchive={revealArchive}
      chooseBundleDestination={chooseBundleDestination}
      chooseBundleToVerify={chooseBundleToVerify}
      chooseBundleToImport={chooseBundleToImport}
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
    assert.ok(screen.getByText('Import a branch from a Git bundle'))
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

  it('verifies a selected bundle without confirmation or mutation', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(
      client,
      async () => {},
      undefined,
      undefined,
      undefined,
      async () => 'C:/exports/repository.bundle'
    )
    await screen.findByText('git version 2.55.0')
    fireEvent.click(screen.getByRole('button', { name: 'Verify a bundle' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].args, [
      'bundle',
      'verify',
      'C:\\exports\\repository.bundle',
    ])
    assert.equal(client.starts[0].confirmed, false)
    assert.equal(screen.queryByRole('alertdialog'), null)
  })

  it('imports one advertised bundle ref through review and mutation-boundary rechecks', async () => {
    const client = new FakeRepositoryToolsClient()
    let refreshes = 0
    const sourceOID = 'a'.repeat(40)
    renderTools(
      client,
      async () => {
        refreshes++
      },
      undefined,
      undefined,
      undefined,
      undefined,
      async () => 'C:/exports/repository.bundle'
    )
    await screen.findByText('git version 2.55.0')

    fireEvent.click(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepStrictEqual(client.starts[0].args, [
      'bundle',
      'verify',
      'C:\\exports\\repository.bundle',
    ])
    client.emitState({
      id: client.starts[0].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })

    await waitFor(() => assert.equal(client.starts.length, 2))
    assert.deepStrictEqual(client.starts[1].args, [
      'bundle',
      'list-heads',
      'C:\\exports\\repository.bundle',
    ])
    client.emitOutput({
      id: client.starts[1].id,
      stream: 'stdout',
      data: `${sourceOID} refs/heads/main\n${'b'.repeat(40)} refs/tags/v2\n`,
    })
    client.emitState({
      id: client.starts[1].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })

    const source = await screen.findByLabelText('Advertised source ref')
    assert.equal((source as HTMLSelectElement).value, 'refs/heads/main')
    fireEvent.change(screen.getByLabelText('New local branch'), {
      target: { value: 'imported/main' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Review bundle import' })
    )

    await waitFor(() => assert.equal(client.starts.length, 3))
    assert.deepStrictEqual(client.starts[2].args, [
      'check-ref-format',
      '--branch',
      'imported/main',
    ])
    client.emitState({
      id: client.starts[2].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 4))
    assert.deepStrictEqual(client.starts[3].args, [
      'show-ref',
      '--verify',
      '--quiet',
      'refs/heads/imported/main',
    ])
    client.emitState({
      id: client.starts[3].id,
      state: 'failed',
      exitCode: 1,
      signal: null,
    })

    const confirmation = await screen.findByRole('alertdialog')
    assert.match(confirmation.textContent ?? '', /refs\/heads\/main/)
    assert.match(confirmation.textContent ?? '', /refs\/heads\/imported\/main/)
    fireEvent.click(
      screen.getByRole('button', { name: 'Import to new branch' })
    )

    await waitFor(() => assert.equal(client.starts.length, 5))
    assert.deepStrictEqual(client.starts[4].args, client.starts[0].args)
    client.emitState({
      id: client.starts[4].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 6))
    client.emitOutput({
      id: client.starts[5].id,
      stream: 'stdout',
      data: `${sourceOID} refs/heads/main\n`,
    })
    client.emitState({
      id: client.starts[5].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 7))
    assert.deepStrictEqual(client.starts[6].args, client.starts[2].args)
    client.emitState({
      id: client.starts[6].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 8))
    assert.deepStrictEqual(client.starts[7].args, client.starts[3].args)
    client.emitState({
      id: client.starts[7].id,
      state: 'failed',
      exitCode: 1,
      signal: null,
    })

    await waitFor(() => assert.equal(client.starts.length, 9))
    assert.deepStrictEqual(client.starts[8].args, [
      'fetch',
      '--no-write-fetch-head',
      '--no-tags',
      '--no-auto-maintenance',
      'C:\\exports\\repository.bundle',
      'refs/heads/main',
    ])
    assert.equal(client.starts[8].confirmed, true)
    client.emitState({
      id: client.starts[8].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })

    await waitFor(() => assert.equal(client.starts.length, 10))
    assert.deepStrictEqual(client.starts[9].args, [
      'cat-file',
      '-e',
      `${sourceOID}^{commit}`,
    ])
    assert.equal(client.starts[9].confirmed, false)
    client.emitState({
      id: client.starts[9].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })

    await waitFor(() => assert.equal(client.starts.length, 11))
    assert.deepStrictEqual(client.starts[10].args, [
      'branch',
      '--no-track',
      '--',
      'imported/main',
      sourceOID,
    ])
    assert.equal(client.starts[10].confirmed, true)
    client.emitState({
      id: client.starts[10].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })

    await waitFor(() => assert.equal(refreshes, 1))
    assert.ok(
      await screen.findByText('Imported refs/heads/main as imported/main.')
    )
  })

  it('never imports when the destination appears during the final recheck', async () => {
    const client = new FakeRepositoryToolsClient()
    const sourceOID = 'a'.repeat(40)
    renderTools(
      client,
      async () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      async () => 'C:/exports/repository.bundle'
    )
    await screen.findByText('git version 2.55.0')
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
    await waitFor(() => assert.equal(client.starts.length, 1))
    client.emitState({
      id: client.starts[0].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 2))
    client.emitOutput({
      id: client.starts[1].id,
      stream: 'stdout',
      data: `${sourceOID} refs/heads/main\n`,
    })
    client.emitState({
      id: client.starts[1].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await screen.findByLabelText('New local branch')
    fireEvent.change(screen.getByLabelText('New local branch'), {
      target: { value: 'imported/main' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Review bundle import' })
    )
    await waitFor(() => assert.equal(client.starts.length, 3))
    client.emitState({
      id: client.starts[2].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 4))
    client.emitState({
      id: client.starts[3].id,
      state: 'failed',
      exitCode: 1,
      signal: null,
    })
    await screen.findByRole('alertdialog')
    fireEvent.click(
      screen.getByRole('button', { name: 'Import to new branch' })
    )
    await waitFor(() => assert.equal(client.starts.length, 5))
    client.emitState({
      id: client.starts[4].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 6))
    client.emitOutput({
      id: client.starts[5].id,
      stream: 'stdout',
      data: `${sourceOID} refs/heads/main\n`,
    })
    client.emitState({
      id: client.starts[5].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 7))
    client.emitState({
      id: client.starts[6].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await waitFor(() => assert.equal(client.starts.length, 8))

    client.emitState({
      id: client.starts[7].id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await screen.findByText(/already exists.*will not be overwritten/i)
    assert.equal(client.starts.length, 8)
    assert.equal(
      client.starts.some(start => start.args[0] === 'fetch'),
      false
    )
    assert.equal(
      client.starts.some(start => start.args[0] === 'branch'),
      false
    )
  })

  it('drops a delayed bundle picker result after the repository changes', async () => {
    const client = new FakeRepositoryToolsClient()
    let resolvePicker: (value: string | null) => void = () => {}
    let pickerReturned = false
    const picker = new Promise<string | null>(resolve => {
      resolvePicker = resolve
    })
    const chooseBundleToImport = async () => {
      const value = await picker
      pickerReturned = true
      return value
    }
    const renderImport = (repositoryPath: string) => (
      <RepositoryBundleImport
        repositoryPath={repositoryPath}
        disabled={false}
        client={client}
        onRefreshRepository={async () => {}}
        onBusyChanged={() => {}}
        chooseBundleToImport={chooseBundleToImport}
      />
    )
    const view = render(renderImport('C:/first'))

    fireEvent.click(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
    view.rerender(renderImport('C:/second'))
    resolvePicker('C:/exports/repository.bundle')

    await waitFor(() => assert.equal(pickerReturned, true))
    assert.equal(client.starts.length, 0)
    assert.ok(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
  })

  it('cancels and resubscribes with the exact client when its identity changes', async () => {
    const firstClient = new FakeRepositoryToolsClient()
    const secondClient = new FakeRepositoryToolsClient()
    const renderImport = (client: FakeRepositoryToolsClient) => (
      <RepositoryBundleImport
        repositoryPath="C:/repo"
        disabled={false}
        client={client}
        onRefreshRepository={async () => {}}
        onBusyChanged={() => {}}
        chooseBundleToImport={async () => 'C:/exports/repository.bundle'}
      />
    )
    const view = render(renderImport(firstClient))

    fireEvent.click(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
    await waitFor(() => assert.equal(firstClient.starts.length, 1))
    const firstRun = firstClient.starts[0].id

    view.rerender(renderImport(secondClient))
    await waitFor(() => assert.deepStrictEqual(firstClient.cancels, [firstRun]))
    assert.deepStrictEqual(secondClient.cancels, [])
    firstClient.emitState({
      id: firstRun,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    assert.equal(secondClient.starts.length, 0)

    fireEvent.click(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
    await waitFor(() => assert.equal(secondClient.starts.length, 1))
  })

  it('keeps refresh completion scoped to its repository and blocks a second picker', async () => {
    const client = new FakeRepositoryToolsClient()
    const request: IRepositoryBundleImportRequest =
      prepareRepositoryBundleImport(
        'C:/exports/repository.bundle',
        { oid: 'a'.repeat(40), ref: 'refs/heads/main' },
        'imported/main'
      )
    let resolveRefresh: () => void = () => {}
    let refreshes = 0
    const refresh = new Promise<void>(resolve => {
      resolveRefresh = resolve
    })
    const onRefreshRepository = () => {
      refreshes++
      return refresh
    }
    const component = React.createRef<RepositoryBundleImport>()
    const renderImport = (repositoryPath: string) => (
      <RepositoryBundleImport
        ref={component}
        repositoryPath={repositoryPath}
        disabled={false}
        client={client}
        onRefreshRepository={onRefreshRepository}
        onBusyChanged={() => {}}
        chooseBundleToImport={async () => 'C:/exports/other.bundle'}
      />
    )
    const view = render(renderImport('C:/first'))
    const mountedComponent = component.current
    assert.ok(mountedComponent)
    mountedComponent.setState({
      phase: 'refreshing',
      bundlePath: request.bundlePath,
      request,
      status: 'Branch created. Refreshing the repository…',
    })
    const refreshCompletion = (
      mountedComponent as unknown as {
        finishRefresh: (
          value: IRepositoryBundleImportRequest,
          repositoryPath: string,
          repositoryGeneration: number
        ) => Promise<void>
      }
    ).finishRefresh(request, 'C:/first', 0)

    await waitFor(() => assert.equal(refreshes, 1))
    const chooseButton = screen.getByRole('button', {
      name: 'Choose another bundle',
    }) as HTMLButtonElement
    assert.equal(chooseButton.getAttribute('aria-disabled'), 'true')
    fireEvent.click(chooseButton)
    assert.equal(client.starts.length, 0)

    view.rerender(renderImport('C:/second'))
    resolveRefresh()
    await refreshCompletion

    assert.ok(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
    assert.equal(
      screen.queryByText('Imported refs/heads/main as imported/main.'),
      null
    )
  })

  it('cancels the exact active bundle inspection without advancing', async () => {
    const client = new FakeRepositoryToolsClient()
    renderTools(
      client,
      async () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      async () => 'C:/exports/repository.bundle'
    )
    await screen.findByText('git version 2.55.0')
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose and inspect a bundle' })
    )
    await waitFor(() => assert.equal(client.starts.length, 1))
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel bundle operation' })
    )
    await waitFor(() =>
      assert.deepStrictEqual(client.cancels, [client.starts[0].id])
    )
    client.emitState({
      id: client.starts[0].id,
      state: 'cancelled',
      exitCode: null,
      signal: 'SIGTERM',
    })
    await screen.findByText(
      'Bundle operation cancelled. No local branch was created.'
    )
    assert.equal(client.starts.length, 1)
  })
})
