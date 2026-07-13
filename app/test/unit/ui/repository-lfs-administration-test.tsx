import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import {
  ICLICommandOutputEvent,
  ICLICommandRequest,
  ICLICommandStateEvent,
} from '../../../src/lib/cli-workbench'
import { RepositoryLFSAdministration } from '../../../src/ui/repository-tools'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

class FakeLFSClient {
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

function renderLFS(
  client: FakeLFSClient,
  repositoryPath = 'C:/repo',
  onRefreshRepository = async () => {},
  onBusyChanged: (busy: boolean) => void = () => {}
) {
  return render(
    <RepositoryLFSAdministration
      repositoryPath={repositoryPath}
      disabled={false}
      client={client}
      onRefreshRepository={onRefreshRepository}
      onBusyChanged={onBusyChanged}
    />
  )
}

function emitCompleted(client: FakeLFSClient, index: number, stdout = '') {
  const id = client.starts[index].id
  if (stdout.length > 0) {
    client.emitOutput({ id, stream: 'stdout', data: stdout })
  }
  client.emitState({
    id,
    state: 'completed',
    exitCode: 0,
    signal: null,
  })
}

async function inspectLFS(client: FakeLFSClient) {
  fireEvent.click(screen.getByRole('button', { name: 'Check Git LFS state' }))
  await waitFor(() => assert.equal(client.starts.length, 1))
  assert.deepStrictEqual(client.starts[0].recipe, {
    kind: 'repository-lfs-inspection',
    operation: 'version',
  })
  emitCompleted(client, 0, 'git-lfs/3.7.1 (GitHub; windows amd64)\n')

  await waitFor(() => assert.equal(client.starts.length, 2))
  assert.deepStrictEqual(client.starts[1].recipe, {
    kind: 'repository-lfs-inspection',
    operation: 'patterns',
  })
  emitCompleted(
    client,
    1,
    JSON.stringify({
      patterns: [
        { pattern: '*.zip', tracked: true },
        { pattern: 'assets/*.psd', tracked: true, lockable: true },
      ],
    })
  )

  await waitFor(() => assert.equal(client.starts.length, 3))
  assert.deepStrictEqual(client.starts[2].recipe, {
    kind: 'repository-lfs-inspection',
    operation: 'status',
  })
  emitCompleted(
    client,
    2,
    JSON.stringify({ files: { 'assets/hero.psd': {}, 'release.zip': {} } })
  )
  await screen.findByLabelText('New tracked pattern')
}

describe('Repository Git LFS administration', () => {
  it('inspects runtime, tracked patterns, and bounded status without raw logs', async () => {
    const client = new FakeLFSClient()
    const busy: boolean[] = []
    renderLFS(
      client,
      'C:/repo',
      async () => {},
      value => busy.push(value)
    )
    await inspectLFS(client)

    assert.ok(screen.getByText('Git LFS 3.7.1'))
    assert.ok(screen.getByText('assets/*.psd'))
    assert.ok(screen.getByText('assets/hero.psd'))
    assert.deepStrictEqual(busy, [true, false])
    assert.equal(screen.queryByRole('log'), null)
  })

  it('freezes, focuses, rechecks, and applies an exact tracked pattern', async () => {
    const client = new FakeLFSClient()
    let refreshes = 0
    renderLFS(client, 'C:/repo', async () => {
      refreshes++
    })
    await inspectLFS(client)
    fireEvent.change(screen.getByLabelText('New tracked pattern'), {
      target: { value: 'media/**/*.mov' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Review tracked pattern' })
    )
    const confirm = await screen.findByRole('button', {
      name: 'Confirm Git LFS action',
    })
    assert.equal(document.activeElement, confirm)
    fireEvent.click(confirm)

    await waitFor(() => assert.equal(client.starts.length, 4))
    assert.deepStrictEqual(client.starts[3].recipe, {
      kind: 'repository-lfs-inspection',
      operation: 'patterns',
    })
    emitCompleted(
      client,
      3,
      JSON.stringify({
        patterns: [
          { pattern: '*.zip', tracked: true },
          { pattern: 'assets/*.psd', tracked: true, lockable: true },
        ],
      })
    )
    await waitFor(() => assert.equal(client.starts.length, 5))
    assert.deepStrictEqual(client.starts[4].recipe, {
      kind: 'repository-lfs-pattern',
      operation: 'track',
      pattern: 'media/**/*.mov',
    })
    assert.equal(client.starts[4].confirmed, true)
    emitCompleted(client, 4)
    await waitFor(() => assert.equal(refreshes, 1))
    await waitFor(() => assert.equal(client.starts.length, 6))
    assert.deepStrictEqual(client.starts[5].recipe, {
      kind: 'repository-lfs-inspection',
      operation: 'version',
    })
  })

  it('fails closed when tracked patterns change after review', async () => {
    const client = new FakeLFSClient()
    renderLFS(client)
    await inspectLFS(client)
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Review removal' })[0]
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm Git LFS action' })
    )
    await waitFor(() => assert.equal(client.starts.length, 4))
    emitCompleted(
      client,
      3,
      JSON.stringify({ patterns: [{ pattern: 'changed.bin', tracked: true }] })
    )

    assert.ok(await screen.findByText(/changed after review/i))
    assert.equal(
      client.starts.some(
        start => start.recipe.kind === 'repository-lfs-pattern'
      ),
      false
    )
  })

  it('runs a dry-run preview before offering verified prune confirmation', async () => {
    const client = new FakeLFSClient()
    renderLFS(client)
    await inspectLFS(client)
    fireEvent.click(screen.getByRole('button', { name: 'Preview prune' }))
    await waitFor(() => assert.equal(client.starts.length, 4))
    assert.deepStrictEqual(client.starts[3].recipe, {
      kind: 'repository-lfs-inspection',
      operation: 'prune-preview',
    })
    emitCompleted(client, 3, '123 objects, 456 MB\nprune secret-object-id\n')

    const confirm = await screen.findByRole('button', {
      name: 'Confirm Git LFS action',
    })
    assert.equal(document.activeElement, confirm)
    assert.ok(screen.getByText(/reported 2 bounded result lines/))
    assert.equal(document.body.textContent?.includes('secret-object-id'), false)
    fireEvent.click(confirm)
    await waitFor(() => assert.equal(client.starts.length, 5))
    assert.deepStrictEqual(client.starts[4].recipe, {
      kind: 'repository-lfs-operation',
      operation: 'prune',
    })
    assert.equal(client.starts[4].confirmed, true)
  })

  it('warns that a failed pull may have changed bounded repository state', async () => {
    const client = new FakeLFSClient()
    renderLFS(client)
    await inspectLFS(client)
    fireEvent.click(screen.getByRole('button', { name: 'Review pull' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm Git LFS action' })
    )
    await waitFor(() => assert.equal(client.starts.length, 4))
    assert.deepStrictEqual(client.starts[3].recipe, {
      kind: 'repository-lfs-operation',
      operation: 'pull',
    })
    client.emitState({
      id: client.starts[3].id,
      state: 'failed',
      exitCode: 2,
      signal: null,
    })

    assert.ok(await screen.findByText(/working-tree files may have changed/i))
    assert.ok(
      screen.getByText('The reviewed Git LFS action did not fully complete.')
    )
  })

  it('rejects unsafe patterns before any mutation recipe is created', async () => {
    const client = new FakeLFSClient()
    renderLFS(client)
    await inspectLFS(client)
    fireEvent.change(screen.getByLabelText('New tracked pattern'), {
      target: { value: '../outside.bin' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Review tracked pattern' })
    )
    assert.ok(await screen.findByText(/safe repository-relative/i))
    assert.equal(client.starts.length, 3)
    assert.equal(screen.queryByRole('alertdialog'), null)
  })

  it('cancels exact work and ignores stale events after repository replacement', async () => {
    const client = new FakeLFSClient()
    const view = renderLFS(client, 'C:/first')
    fireEvent.click(screen.getByRole('button', { name: 'Check Git LFS state' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    const staleId = client.starts[0].id
    view.rerender(
      <RepositoryLFSAdministration
        repositoryPath="C:/second"
        disabled={false}
        client={client}
        onRefreshRepository={async () => {}}
        onBusyChanged={() => {}}
      />
    )
    await waitFor(() => assert.deepStrictEqual(client.cancels, [staleId]))
    client.emitOutput({
      id: staleId,
      stream: 'stdout',
      data: 'git-lfs/9.9.9',
    })
    client.emitState({
      id: staleId,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    assert.equal(client.starts.length, 1)
    assert.ok(
      screen.getByText(
        'Check the bundled Git LFS runtime and repository state.'
      )
    )
  })
})
