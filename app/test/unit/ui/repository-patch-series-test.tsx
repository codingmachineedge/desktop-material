import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as React from 'react'
import {
  ICLICommandOutputEvent,
  ICLICommandRequest,
  ICLICommandStateEvent,
} from '../../../src/lib/cli-workbench'
import { RepositoryPatchSeries } from '../../../src/ui/repository-tools'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

class FakePatchClient {
  public readonly starts = new Array<ICLICommandRequest>()
  public readonly cancels = new Array<string>()
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

function renderPatchSeries(
  client: FakePatchClient,
  options: {
    readonly chooseExportDestination?: () => Promise<string | null>
    readonly choosePatchFiles?: () => Promise<ReadonlyArray<string>>
    readonly onRefreshRepository?: () => Promise<void>
  }
) {
  return render(
    <RepositoryPatchSeries
      repositoryPath="C:/repo"
      disabled={false}
      client={client}
      onRefreshRepository={options.onRefreshRepository ?? (async () => {})}
      onBusyChanged={() => undefined}
      chooseExportDestination={options.chooseExportDestination}
      choosePatchFiles={options.choosePatchFiles}
    />
  )
}

describe('Repository patch series', () => {
  it('reviews and exports commits ahead of upstream to a new folder', async () => {
    const client = new FakePatchClient()
    let refreshes = 0
    renderPatchSeries(client, {
      chooseExportDestination: async () => 'C:/exports/review',
      onRefreshRepository: async () => {
        refreshes++
      },
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Choose export destination' })
    )
    await screen.findByRole('alertdialog')
    assert.match(
      screen.getByRole('alertdialog').textContent ?? '',
      /review\.patches/
    )
    fireEvent.click(screen.getByRole('button', { name: 'Export patch series' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepEqual(client.starts[0].recipe, {
      kind: 'repository-patch-export',
      destination: 'C:\\exports\\review.patches',
    })
    assert.equal(client.starts[0].confirmed, true)

    const id = client.starts[0].id
    client.emitOutput({ id, stream: 'stdout', data: '0001\n' })
    client.emitState({
      id,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    await screen.findByText('Patch series exported to a new folder.')
    assert.equal(refreshes, 1)
  })

  it('reviews patch order and exposes continue, skip, and abort recovery', async () => {
    const client = new FakePatchClient()
    renderPatchSeries(client, {
      choosePatchFiles: async () => [
        'C:/patches/0001-first.patch',
        'C:/patches/0002-second.patch',
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Choose patch files' }))
    await screen.findByRole('alertdialog')
    assert.ok(screen.getByText('0001-first.patch'))
    assert.ok(screen.getByText('0002-second.patch'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply patch series' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    assert.deepEqual(client.starts[0].recipe, {
      kind: 'repository-patch-import',
      patchPaths: [
        'C:\\patches\\0001-first.patch',
        'C:\\patches\\0002-second.patch',
      ],
    })

    client.emitState({
      id: client.starts[0].id,
      state: 'failed',
      exitCode: 1,
      signal: null,
    })
    await screen.findByRole('group', { name: 'Patch conflict recovery' })
    assert.ok(screen.getByRole('button', { name: 'Continue' }))
    assert.ok(screen.getByRole('button', { name: 'Skip patch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abort import' }))
    await waitFor(() => assert.equal(client.starts.length, 2))
    assert.deepEqual(client.starts[1].recipe, {
      kind: 'repository-patch-session',
      operation: 'abort',
    })
  })

  it('cancels only the exact active patch run', async () => {
    const client = new FakePatchClient()
    renderPatchSeries(client, {
      chooseExportDestination: async () => 'C:/exports/review.patches',
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose export destination' })
    )
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: 'Export patch series' }))
    await waitFor(() => assert.equal(client.starts.length, 1))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.deepEqual(client.cancels, [client.starts[0].id])
  })

  it('does not offer conflict recovery when an import never starts', async () => {
    const client = new FakePatchClient()
    client.start = async request => {
      client.starts.push(request)
      throw new Error('Rejected before Git started.')
    }
    renderPatchSeries(client, {
      choosePatchFiles: async () => ['C:/patches/0001-first.patch'],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Choose patch files' }))
    await screen.findByRole('alertdialog')
    fireEvent.click(screen.getByRole('button', { name: 'Apply patch series' }))

    await screen.findByRole('alert')
    assert.equal(
      screen.queryByRole('group', { name: 'Patch conflict recovery' }),
      null
    )
  })
})
