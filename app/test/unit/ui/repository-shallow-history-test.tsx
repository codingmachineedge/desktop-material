import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as React from 'react'
import {
  ICLICommandOutputEvent,
  ICLICommandRequest,
  ICLICommandStateEvent,
} from '../../../src/lib/cli-workbench'
import {
  prepareRepositoryHistoryDeepen,
  RepositoryShallowHistory,
} from '../../../src/ui/repository-tools'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

class FakeShallowHistoryClient {
  public readonly starts: ICLICommandRequest[] = []
  public readonly cancels: string[] = []
  private readonly outputHandlers = new Set<
    (event: ICLICommandOutputEvent) => void
  >()
  private readonly stateHandlers = new Set<
    (event: ICLICommandStateEvent) => void
  >()

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

function renderHistory(
  client: FakeShallowHistoryClient,
  repositoryPath = 'C:/repo',
  onRefreshRepository = async () => {},
  onBusyChanged: (busy: boolean) => void = () => {}
) {
  return render(
    <RepositoryShallowHistory
      repositoryPath={repositoryPath}
      disabled={false}
      client={client}
      onRefreshRepository={onRefreshRepository}
      onBusyChanged={onBusyChanged}
    />
  )
}

function emitCompleted(
  client: FakeShallowHistoryClient,
  index: number,
  stdout?: string
) {
  const id = client.starts[index].id
  if (stdout !== undefined) {
    client.emitOutput({ id, stream: 'stdout', data: stdout })
  }
  client.emitState({
    id,
    state: 'completed',
    exitCode: 0,
    signal: null,
  })
}

async function inspectShallowRepository(
  client: FakeShallowHistoryClient,
  remotes = 'origin\nupstream\n'
) {
  fireEvent.click(screen.getByRole('button', { name: 'Check history status' }))
  await waitFor(() => assert.equal(client.starts.length, 1))
  assert.deepStrictEqual(client.starts[0].args, [
    'rev-parse',
    '--is-shallow-repository',
  ])
  assert.equal(client.starts[0].confirmed, false)
  emitCompleted(client, 0, 'true\n')

  await waitFor(() => assert.equal(client.starts.length, 2))
  assert.deepStrictEqual(client.starts[1].args, ['remote'])
  emitCompleted(client, 1, remotes)
  await screen.findByLabelText('Additional commits')
}

async function advanceReviewedActionToFetch(client: FakeShallowHistoryClient) {
  fireEvent.click(
    screen.getByRole('button', { name: /^(Deepen by|Fetch full history)/ })
  )
  await waitFor(() => assert.equal(client.starts.length, 3))
  assert.deepStrictEqual(client.starts[2].args, [
    'rev-parse',
    '--is-shallow-repository',
  ])
  emitCompleted(client, 2, 'true\n')

  await waitFor(() => assert.equal(client.starts.length, 4))
  assert.deepStrictEqual(client.starts[3].args, ['remote'])
  emitCompleted(client, 3, 'origin\nupstream\n')
  await waitFor(() => assert.equal(client.starts.length, 5))
}

describe('Repository shallow history', () => {
  it('uses a local read-only check and disables mutation for full repositories', async () => {
    const client = new FakeShallowHistoryClient()
    renderHistory(client)

    assert.ok(screen.getByText('Deepen a shallow repository'))
    assert.equal(screen.queryByRole('searchbox'), null)
    assert.equal(screen.queryByRole('textbox'), null)
    assert.equal(screen.queryByRole('spinbutton'), null)

    fireEvent.click(
      screen.getByRole('button', { name: 'Check history status' })
    )
    await waitFor(() => assert.equal(client.starts.length, 1))
    emitCompleted(client, 0, 'false\n')

    await screen.findByText('Full history')
    assert.ok(
      screen.getByText(
        'This repository already has full history. No deepen action is needed.'
      )
    )
    assert.equal(client.starts.length, 1)
    assert.equal(screen.queryByLabelText('Additional commits'), null)
    assert.equal(
      screen
        .getByRole('button', { name: 'Review full history' })
        .getAttribute('aria-disabled'),
      'true'
    )
  })

  it('reviews, rechecks, deepens, refreshes, and confirms current state', async () => {
    const client = new FakeShallowHistoryClient()
    const busyStates: boolean[] = []
    let refreshes = 0
    renderHistory(
      client,
      'C:/repo',
      async () => {
        refreshes++
      },
      busy => busyStates.push(busy)
    )
    await inspectShallowRepository(client)

    const input = screen.getByLabelText('Additional commits')
    fireEvent.change(input, { target: { value: '1000001' } })
    assert.equal(
      screen
        .getByRole('button', { name: 'Review bounded deepen' })
        .getAttribute('aria-disabled'),
      'true'
    )
    fireEvent.change(input, { target: { value: '75' } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Review bounded deepen' })
    )

    const confirmation = await screen.findByRole('alertdialog')
    assert.match(confirmation.textContent ?? '', /Deepen by 75 commits/)
    assert.match(
      confirmation.textContent ?? '',
      /Fetch 75 commits beyond each current shallow boundary from origin/
    )
    const confirm = screen.getByRole('button', {
      name: 'Deepen by 75 commits',
    })
    await waitFor(() => assert.equal(document.activeElement, confirm))
    assert.equal(client.starts.length, 2)

    await advanceReviewedActionToFetch(client)
    assert.deepStrictEqual(client.starts[4], {
      id: client.starts[4].id,
      tool: 'git',
      args: [
        'fetch',
        '--no-auto-maintenance',
        '--no-recurse-submodules',
        '--no-write-fetch-head',
        '--deepen=75',
        '--',
        'origin',
      ],
      cwd: 'C:/repo',
      confirmed: true,
    })

    emitCompleted(client, 4, 'Fetched older objects.\n')
    await waitFor(() => assert.equal(refreshes, 1))
    await waitFor(() => assert.equal(client.starts.length, 6))
    assert.deepStrictEqual(client.starts[5].args, [
      'rev-parse',
      '--is-shallow-repository',
    ])
    emitCompleted(client, 5, 'true\n')

    assert.ok(
      await screen.findByText(
        'Fetched 75 additional commits of history from origin. The repository still has a shallow boundary.'
      )
    )
    assert.equal(
      screen.getByLabelText('Additional commits').getAttribute('value'),
      '75'
    )
    assert.ok(busyStates.includes(true))
    assert.equal(busyStates[busyStates.length - 1], false)
  })

  it('keeps the full-history action distinct and reports an unshallowed result', async () => {
    const client = new FakeShallowHistoryClient()
    let refreshes = 0
    renderHistory(client, 'C:/repo', async () => {
      refreshes++
    })
    await inspectShallowRepository(client)

    fireEvent.click(screen.getByRole('button', { name: 'Review full history' }))
    const confirmation = await screen.findByRole('alertdialog')
    assert.match(
      confirmation.textContent ?? '',
      /Remove this repository’s shallow boundary/
    )
    await advanceReviewedActionToFetch(client)
    assert.deepStrictEqual(client.starts[4].args, [
      'fetch',
      '--no-auto-maintenance',
      '--no-recurse-submodules',
      '--no-write-fetch-head',
      '--unshallow',
      '--',
      'origin',
    ])
    assert.equal(client.starts[4].confirmed, true)

    emitCompleted(client, 4)
    await waitFor(() => assert.equal(refreshes, 1))
    await waitFor(() => assert.equal(client.starts.length, 6))
    emitCompleted(client, 5, 'false\n')
    assert.ok(
      await screen.findByText(
        'Fetched full history from origin. This repository is no longer shallow.'
      )
    )
    assert.equal(screen.queryByLabelText('Additional commits'), null)
  })

  it('fails closed when the repository becomes non-shallow after review', async () => {
    const client = new FakeShallowHistoryClient()
    renderHistory(client)
    await inspectShallowRepository(client)
    fireEvent.click(
      screen.getByRole('button', { name: 'Review bounded deepen' })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Deepen by 50 commits' })
    )
    await waitFor(() => assert.equal(client.starts.length, 3))
    emitCompleted(client, 2, 'false\n')

    assert.ok(
      await screen.findByText(
        'The repository is no longer shallow. Nothing was fetched.'
      )
    )
    assert.equal(client.starts.length, 3)
    assert.equal(
      client.starts.some(start => start.args[0] === 'fetch'),
      false
    )
  })

  it('fails closed when the reviewed remote disappears at the mutation boundary', async () => {
    const client = new FakeShallowHistoryClient()
    renderHistory(client)
    await inspectShallowRepository(client)
    fireEvent.click(
      screen.getByRole('button', { name: 'Review bounded deepen' })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Deepen by 50 commits' })
    )
    await waitFor(() => assert.equal(client.starts.length, 3))
    emitCompleted(client, 2, 'true\n')
    await waitFor(() => assert.equal(client.starts.length, 4))
    emitCompleted(client, 3, 'upstream\n')

    assert.ok(
      await screen.findByText(/selected fetch remote changed after review/i)
    )
    assert.equal(client.starts.length, 4)
    assert.equal(
      client.starts.some(start => start.args[0] === 'fetch'),
      false
    )
  })

  it('rejects unsafe remote output before it can reach a control or recipe', async () => {
    const client = new FakeShallowHistoryClient()
    renderHistory(client)
    fireEvent.click(
      screen.getByRole('button', { name: 'Check history status' })
    )
    await waitFor(() => assert.equal(client.starts.length, 1))
    emitCompleted(client, 0, 'true\n')
    await waitFor(() => assert.equal(client.starts.length, 2))
    emitCompleted(client, 1, '--upload-pack=payload\n')

    assert.ok(await screen.findByText(/valid configured fetch remote/i))
    assert.equal(screen.queryByLabelText('Fetch remote'), null)
    assert.equal(
      client.starts.some(start => start.args[0] === 'fetch'),
      false
    )
  })

  it('turns a fetch failure into actionable guidance without refreshing', async () => {
    const client = new FakeShallowHistoryClient()
    let refreshes = 0
    renderHistory(client, 'C:/repo', async () => {
      refreshes++
    })
    await inspectShallowRepository(client)
    fireEvent.click(
      screen.getByRole('button', { name: 'Review bounded deepen' })
    )
    await advanceReviewedActionToFetch(client)

    client.emitState({
      id: client.starts[4].id,
      state: 'failed',
      exitCode: 128,
      signal: null,
      error: 'Could not resolve host for the selected remote.',
    })

    assert.ok(await screen.findByText('The history fetch did not complete.'))
    const alert = screen.getByRole('alert')
    assert.match(alert.textContent ?? '', /check the selected remote/i)
    assert.match(alert.textContent ?? '', /could not resolve host/i)
    assert.equal(refreshes, 0)
    assert.equal(client.starts.length, 5)
  })

  it('cancels the exact run and never advances a cancelled inspection', async () => {
    const client = new FakeShallowHistoryClient()
    renderHistory(client)
    fireEvent.click(
      screen.getByRole('button', { name: 'Check history status' })
    )
    await waitFor(() => assert.equal(client.starts.length, 1))
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel history operation' })
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

    await screen.findByText('History operation cancelled. Nothing was fetched.')
    assert.equal(client.starts.length, 1)
  })

  it('cancels old work and ignores stale completion after repository replacement', async () => {
    const client = new FakeShallowHistoryClient()
    const renderFor = (repositoryPath: string) => (
      <RepositoryShallowHistory
        repositoryPath={repositoryPath}
        disabled={false}
        client={client}
        onRefreshRepository={async () => {}}
        onBusyChanged={() => {}}
      />
    )
    const view = render(renderFor('C:/first'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Check history status' })
    )
    await waitFor(() => assert.equal(client.starts.length, 1))
    const staleId = client.starts[0].id

    view.rerender(renderFor('C:/second'))
    await waitFor(() => assert.deepStrictEqual(client.cancels, [staleId]))
    client.emitOutput({ id: staleId, stream: 'stdout', data: 'true\n' })
    client.emitState({
      id: staleId,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    assert.equal(client.starts.length, 1)
    assert.ok(screen.getByText('Not checked'))

    fireEvent.click(
      screen.getByRole('button', { name: 'Check history status' })
    )
    await waitFor(() => assert.equal(client.starts.length, 2))
    assert.equal(client.starts[1].cwd, 'C:/second')
  })

  it('drops a delayed refresh completion after repository replacement', async () => {
    const client = new FakeShallowHistoryClient()
    let resolveRefresh: () => void = () => {}
    const refresh = new Promise<void>(resolve => {
      resolveRefresh = resolve
    })
    const component = React.createRef<RepositoryShallowHistory>()
    const renderFor = (repositoryPath: string) => (
      <RepositoryShallowHistory
        ref={component}
        repositoryPath={repositoryPath}
        disabled={false}
        client={client}
        onRefreshRepository={() => refresh}
        onBusyChanged={() => {}}
      />
    )
    const view = render(renderFor('C:/first'))
    const request = prepareRepositoryHistoryDeepen('origin', '50')
    const mountedComponent = component.current
    assert.ok(mountedComponent)
    mountedComponent.setState({
      phase: 'refreshing',
      isShallow: true,
      remotes: ['origin'],
      selectedRemote: 'origin',
      request,
      status: 'Older history fetched. Refreshing repository state…',
    })
    const completion = (
      mountedComponent as unknown as {
        finishRefresh: (
          value: ReturnType<typeof prepareRepositoryHistoryDeepen>,
          repositoryPath: string,
          repositoryGeneration: number
        ) => Promise<void>
      }
    ).finishRefresh(request, 'C:/first', 0)

    view.rerender(renderFor('C:/second'))
    resolveRefresh()
    await completion
    assert.equal(client.starts.length, 0)
    assert.ok(screen.getByText('Not checked'))
  })
})
