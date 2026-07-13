import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import {
  ICLICommandOutputEvent,
  ICLICommandRequest,
  ICLICommandStateEvent,
} from '../../../src/lib/cli-workbench'
import { RepositoryBisectSession } from '../../../src/ui/repository-tools'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

class FakeBisectClient {
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

function renderBisect(
  client: FakeBisectClient,
  repositoryPath = 'C:/fixture',
  onRefreshRepository = async () => {},
  onBusyChanged: (busy: boolean) => void = () => {}
) {
  return render(
    <RepositoryBisectSession
      repositoryPath={repositoryPath}
      disabled={false}
      client={client}
      onRefreshRepository={onRefreshRepository}
      onBusyChanged={onBusyChanged}
    />
  )
}

function emitCompleted(client: FakeBisectClient, index: number, stdout = '') {
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

async function inspectInactive(client: FakeBisectClient, worktreeOutput = '') {
  fireEvent.click(
    screen.getByRole('button', { name: 'Inspect or resume session' })
  )
  await waitFor(() => assert.equal(client.starts.length, 1))
  assert.deepStrictEqual(client.starts[0].recipe, {
    kind: 'repository-bisect-inspection',
    operation: 'state',
  })
  emitCompleted(client, 0)
  await waitFor(() => assert.equal(client.starts.length, 2))
  emitCompleted(client, 1, `${'d'.repeat(40)}\0dddddddd\0Current branch tip\n`)
  await waitFor(() => assert.equal(client.starts.length, 3))
  assert.deepStrictEqual(client.starts[2].recipe, {
    kind: 'repository-bisect-inspection',
    operation: 'worktree',
  })
  emitCompleted(client, 2, worktreeOutput)
}

async function inspectActive(
  client: FakeBisectClient,
  startIndex = 0,
  worktreeOutput = ''
) {
  const good = 'a'.repeat(40)
  const current = 'b'.repeat(40)
  const bad = 'c'.repeat(40)
  if (startIndex === 0) {
    fireEvent.click(
      screen.getByRole('button', { name: 'Inspect or resume session' })
    )
  }
  await waitFor(() => assert.equal(client.starts.length, startIndex + 1))
  emitCompleted(
    client,
    startIndex,
    `refs/bisect/bad\0${bad}\nrefs/bisect/good-${good}\0${good}\n`
  )
  await waitFor(() => assert.equal(client.starts.length, startIndex + 2))
  emitCompleted(
    client,
    startIndex + 1,
    `${current}\0bbbbbbbb\0Candidate commit\n`
  )
  await waitFor(() => assert.equal(client.starts.length, startIndex + 3))
  emitCompleted(client, startIndex + 2, '5\n')
  await waitFor(() => assert.equal(client.starts.length, startIndex + 4))
  emitCompleted(client, startIndex + 3, worktreeOutput)
  return { good, current, bad }
}

describe('Repository guided bisect session', () => {
  it('inspects inactive state without showing raw Git output or file names', async () => {
    const client = new FakeBisectClient()
    const busy: boolean[] = []
    renderBisect(
      client,
      'C:/fixture',
      async () => {},
      value => busy.push(value)
    )
    await inspectInactive(client)

    assert.ok(await screen.findByLabelText('Known-good revision'))
    assert.ok(screen.getByLabelText('Known-bad revision'))
    assert.ok(screen.getByText('No active session'))
    assert.equal(screen.queryByRole('log'), null)
    assert.equal(document.body.textContent?.includes('refs/bisect'), false)
    assert.deepStrictEqual(busy, [true, false])
  })

  it('resolves, validates, focuses, and starts only the exact reviewed range', async () => {
    const client = new FakeBisectClient()
    let refreshes = 0
    renderBisect(client, 'C:/fixture', async () => {
      refreshes++
    })
    await inspectInactive(client)

    fireEvent.change(screen.getByLabelText('Known-good revision'), {
      target: { value: 'release/v1' },
    })
    fireEvent.change(screen.getByLabelText('Known-bad revision'), {
      target: { value: 'main' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review bisect range' }))

    await waitFor(() => assert.equal(client.starts.length, 4))
    assert.deepStrictEqual(client.starts[3], {
      id: client.starts[3].id,
      repositoryPath: 'C:/fixture',
      recipe: { kind: 'repository-bisect-resolve', revision: 'release/v1' },
      confirmed: false,
    })
    emitCompleted(client, 3, `${'a'.repeat(40)}\n`)
    await waitFor(() => assert.equal(client.starts.length, 5))
    assert.deepStrictEqual(client.starts[4].recipe, {
      kind: 'repository-bisect-resolve',
      revision: 'main',
    })
    emitCompleted(client, 4, `${'c'.repeat(40)}\n`)
    await waitFor(() => assert.equal(client.starts.length, 6))
    assert.deepStrictEqual(client.starts[5].recipe, {
      kind: 'repository-bisect-range',
      goodOid: 'a'.repeat(40),
      badOid: 'c'.repeat(40),
    })
    emitCompleted(client, 5)

    const confirm = await screen.findByRole('button', {
      name: 'Start guided bisect',
    })
    assert.equal(document.activeElement, confirm)
    assert.ok(screen.getByRole('alertdialog'))
    assert.equal(
      screen
        .getByRole('button', { name: 'Inspect or resume session' })
        .getAttribute('aria-disabled'),
      'true'
    )
    fireEvent.click(confirm)
    await waitFor(() => assert.equal(client.starts.length, 7))
    assert.deepStrictEqual(client.starts[6].recipe, {
      kind: 'repository-bisect-start',
      goodOid: 'a'.repeat(40),
      badOid: 'c'.repeat(40),
    })
    assert.equal(client.starts[6].confirmed, true)
    emitCompleted(client, 6)

    await waitFor(() => assert.equal(refreshes, 1))
    await inspectActive(client, 7)
    assert.ok(
      await screen.findByRole('region', { name: 'Bisect session progress' })
    )
    assert.ok(
      screen.getByText(
        '5 candidates remain; approximately 3 additional test steps.'
      )
    )
  })

  it('reviews and records an exact current verdict, then safely resumes', async () => {
    const client = new FakeBisectClient()
    let refreshes = 0
    renderBisect(client, 'C:/fixture', async () => {
      refreshes++
    })
    const { current } = await inspectActive(client)

    fireEvent.click(
      screen.getByRole('button', { name: 'Mark current commit good' })
    )
    const confirm = await screen.findByRole('button', { name: 'Confirm good' })
    assert.equal(document.activeElement, confirm)
    fireEvent.click(confirm)
    await waitFor(() => assert.equal(client.starts.length, 5))
    assert.deepStrictEqual(client.starts[4].recipe, {
      kind: 'repository-bisect-mark',
      verdict: 'good',
      expectedHead: current,
    })
    assert.equal(client.starts[4].confirmed, true)
    emitCompleted(client, 4)
    await waitFor(() => assert.equal(refreshes, 1))
    await waitFor(() => assert.equal(client.starts.length, 6))
    assert.deepStrictEqual(client.starts[5].recipe, {
      kind: 'repository-bisect-inspection',
      operation: 'state',
    })
  })

  it('confirms reset separately and restores through the fixed reset recipe', async () => {
    const client = new FakeBisectClient()
    renderBisect(client)
    await inspectActive(client)

    fireEvent.click(
      screen.getByRole('button', {
        name: 'End bisect and restore starting branch',
      })
    )
    const confirm = await screen.findByRole('button', {
      name: 'End and restore',
    })
    assert.equal(document.activeElement, confirm)
    fireEvent.click(confirm)
    await waitFor(() => assert.equal(client.starts.length, 5))
    assert.deepStrictEqual(client.starts[4], {
      id: client.starts[4].id,
      repositoryPath: 'C:/fixture',
      recipe: { kind: 'repository-bisect-reset' },
      confirmed: true,
    })
  })

  it('fails closed on a dirty worktree without rendering private paths', async () => {
    const client = new FakeBisectClient()
    renderBisect(client)
    await inspectActive(client, 0, '?? private-folder/identity.txt\0')

    assert.ok(
      await screen.findByText(
        /Commit, stash, or discard all tracked and untracked changes/
      )
    )
    assert.equal(
      screen
        .getByRole('button', { name: 'Mark current commit good' })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.equal(document.body.textContent?.includes('identity.txt'), false)
    assert.equal(document.body.textContent?.includes('private-folder'), false)
  })

  it('cancels the exact run and ignores its late completion after repository change', async () => {
    const client = new FakeBisectClient()
    const busy: boolean[] = []
    const view = renderBisect(
      client,
      'C:/first',
      async () => {},
      value => busy.push(value)
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Inspect or resume session' })
    )
    await waitFor(() => assert.equal(client.starts.length, 1))
    const firstId = client.starts[0].id
    view.rerender(
      <RepositoryBisectSession
        repositoryPath="C:/second"
        disabled={false}
        client={client}
        onRefreshRepository={async () => {}}
        onBusyChanged={value => busy.push(value)}
      />
    )
    await waitFor(() => assert.deepStrictEqual(client.cancels, [firstId]))
    client.emitOutput({
      id: firstId,
      stream: 'stdout',
      data: 'refs/bisect/private\0secret\n',
    })
    client.emitState({
      id: firstId,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    assert.ok(
      screen.getByText(
        'Inspect the repository to start or resume a bisect session.'
      )
    )
    assert.equal(document.body.textContent?.includes('secret'), false)
    assert.deepStrictEqual(busy, [true, false])
  })
})
