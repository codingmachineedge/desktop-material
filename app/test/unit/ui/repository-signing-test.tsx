import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import {
  ICLICommandOutputEvent,
  ICLICommandRequest,
  ICLICommandStateEvent,
} from '../../../src/lib/cli-workbench'
import { RepositorySigning } from '../../../src/ui/repository-tools'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

class FakeSigningClient {
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

function renderSigning(
  client: FakeSigningClient,
  repositoryPath = 'C:/repo',
  onRefreshRepository = async () => {},
  onBusyChanged: (busy: boolean) => void = () => {}
) {
  return render(
    <RepositorySigning
      repositoryPath={repositoryPath}
      disabled={false}
      client={client}
      onRefreshRepository={onRefreshRepository}
      onBusyChanged={onBusyChanged}
    />
  )
}

function emitCompleted(client: FakeSigningClient, index: number, stdout = '') {
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

function emitEmptyConfig(client: FakeSigningClient, index: number) {
  client.emitState({
    id: client.starts[index].id,
    state: 'failed',
    exitCode: 1,
    signal: null,
  })
}

async function inspectSigning(client: FakeSigningClient) {
  fireEvent.click(
    screen.getByRole('button', { name: 'Inspect signing settings' })
  )
  await waitFor(() => assert.equal(client.starts.length, 1))
  assert.deepStrictEqual(client.starts[0].recipe, {
    kind: 'repository-signing-inspection',
    scope: 'local',
    operation: 'settings',
  })
  emitCompleted(
    client,
    0,
    'gpg.format\nssh\0commit.gpgsign\ntrue\0tag.gpgsign\nfalse\0'
  )

  await waitFor(() => assert.equal(client.starts.length, 2))
  assert.deepStrictEqual(client.starts[1].recipe, {
    kind: 'repository-signing-inspection',
    scope: 'local',
    operation: 'key-presence',
  })
  emitCompleted(client, 1, 'user.signingkey\0')

  await waitFor(() => assert.equal(client.starts.length, 3))
  assert.deepStrictEqual(client.starts[2].recipe, {
    kind: 'repository-signing-inspection',
    scope: 'global',
    operation: 'settings',
  })
  emitEmptyConfig(client, 2)

  await waitFor(() => assert.equal(client.starts.length, 4))
  assert.deepStrictEqual(client.starts[3].recipe, {
    kind: 'repository-signing-inspection',
    scope: 'global',
    operation: 'key-presence',
  })
  emitEmptyConfig(client, 3)
  await screen.findByLabelText('Replacement public key')
}

describe('Repository signing administration', () => {
  it('inspects only safe settings and name-only key presence', async () => {
    const client = new FakeSigningClient()
    const busy: boolean[] = []
    renderSigning(
      client,
      'C:/repo',
      async () => {},
      value => busy.push(value)
    )
    await inspectSigning(client)

    assert.ok(
      screen.getByText(
        'Configured public signing key (value hidden) (This repository)'
      )
    )
    assert.ok(screen.getByText('Signing configuration inspected safely.'))
    assert.deepStrictEqual(busy, [true, false])
    assert.equal(document.body.textContent?.includes('user.signingkey'), false)
    assert.equal(document.body.textContent?.includes('C:/private'), false)
  })

  it('freezes, focuses, rechecks, and applies exact reviewed settings', async () => {
    const client = new FakeSigningClient()
    let refreshes = 0
    renderSigning(client, 'C:/repo', async () => {
      refreshes++
    })
    await inspectSigning(client)

    const key = `key::ssh-ed25519 ${Buffer.alloc(32, 4).toString('base64')}`
    fireEvent.change(screen.getByLabelText('Replacement public key'), {
      target: { value: key },
    })
    fireEvent.click(screen.getByLabelText('Sign annotated tags by default'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Review signing settings' })
    )

    const confirm = await screen.findByRole('button', {
      name: 'Apply signing settings',
    })
    assert.equal(document.activeElement, confirm)
    fireEvent.click(confirm)

    await waitFor(() => assert.equal(client.starts.length, 5))
    assert.deepStrictEqual(client.starts[4].recipe, {
      kind: 'repository-signing-inspection',
      scope: 'local',
      operation: 'settings',
    })
    emitCompleted(
      client,
      4,
      'gpg.format\nssh\0commit.gpgsign\ntrue\0tag.gpgsign\nfalse\0'
    )
    await waitFor(() => assert.equal(client.starts.length, 6))
    emitCompleted(client, 5, 'user.signingkey\0')

    const expected = [
      {
        kind: 'repository-signing-update',
        scope: 'local',
        operation: 'set-format',
        format: 'ssh',
      },
      {
        kind: 'repository-signing-update',
        scope: 'local',
        operation: 'set-key',
        format: 'ssh',
        key,
      },
      {
        kind: 'repository-signing-update',
        scope: 'local',
        operation: 'set-commit-signing',
        enabled: true,
      },
      {
        kind: 'repository-signing-update',
        scope: 'local',
        operation: 'set-tag-signing',
        enabled: true,
      },
    ]
    for (let index = 0; index < expected.length; index++) {
      await waitFor(() => assert.equal(client.starts.length, 7 + index))
      assert.deepStrictEqual(client.starts[6 + index].recipe, expected[index])
      assert.equal(client.starts[6 + index].confirmed, true)
      emitCompleted(client, 6 + index)
    }
    await waitFor(() => assert.equal(refreshes, 1))
    await waitFor(() => assert.equal(client.starts.length, 11))
    assert.deepStrictEqual(client.starts[10].recipe, {
      kind: 'repository-signing-inspection',
      scope: 'local',
      operation: 'settings',
    })
  })

  it('fails closed if configuration changes after review', async () => {
    const client = new FakeSigningClient()
    renderSigning(client)
    await inspectSigning(client)
    fireEvent.click(
      screen.getByRole('button', { name: 'Review signing settings' })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Apply signing settings' })
    )
    await waitFor(() => assert.equal(client.starts.length, 5))
    emitCompleted(
      client,
      4,
      'gpg.format\nopenpgp\0commit.gpgsign\nfalse\0tag.gpgsign\nfalse\0'
    )
    await waitFor(() => assert.equal(client.starts.length, 6))
    emitCompleted(client, 5, 'user.signingkey\0')

    assert.ok(await screen.findByText(/changed after review/i))
    assert.equal(
      client.starts.some(
        start => start.recipe.kind === 'repository-signing-update'
      ),
      false
    )
  })

  it('warns that a sequential update may be partially applied on failure', async () => {
    const client = new FakeSigningClient()
    renderSigning(client)
    await inspectSigning(client)
    fireEvent.click(
      screen.getByRole('button', { name: 'Review signing settings' })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Apply signing settings' })
    )
    await waitFor(() => assert.equal(client.starts.length, 5))
    emitCompleted(
      client,
      4,
      'gpg.format\nssh\0commit.gpgsign\ntrue\0tag.gpgsign\nfalse\0'
    )
    await waitFor(() => assert.equal(client.starts.length, 6))
    emitCompleted(client, 5, 'user.signingkey\0')
    await waitFor(() => assert.equal(client.starts.length, 7))
    client.emitState({
      id: client.starts[6].id,
      state: 'failed',
      exitCode: 5,
      signal: null,
    })

    assert.ok(await screen.findByText(/may already be applied/i))
    assert.ok(screen.getByText('The signing update did not fully complete.'))
  })

  it('reports safe commit and annotated-tag verification states', async () => {
    const client = new FakeSigningClient()
    renderSigning(client)
    await inspectSigning(client)
    const oid = 'a'.repeat(40)

    fireEvent.click(screen.getByRole('button', { name: 'Verify HEAD commit' }))
    await waitFor(() => assert.equal(client.starts.length, 5))
    emitCompleted(client, 4, `${oid}\0N\0\0`)
    assert.ok(await screen.findByText('Unsigned'))

    fireEvent.click(screen.getByRole('button', { name: 'Load annotated tags' }))
    await waitFor(() => assert.equal(client.starts.length, 6))
    emitCompleted(client, 5, `v1.0.0\0tag\0${oid}\n`)
    await screen.findByLabelText('Annotated tag')
    fireEvent.click(screen.getByRole('button', { name: 'Verify selected tag' }))
    await waitFor(() => assert.equal(client.starts.length, 7))
    assert.deepStrictEqual(client.starts[6].recipe, {
      kind: 'repository-signing-verify',
      target: 'tag',
      tagName: 'v1.0.0',
      expectedObject: oid,
    })
    emitCompleted(client, 6, `${oid}\0G\0ABCDEF0123456789\0ABCDEF01`)
    assert.ok(await screen.findByText('Good signature'))
    assert.ok(screen.getByText('ABCDEF0123456789'))
  })

  it('cancels exact work and ignores stale completion after repository replacement', async () => {
    const client = new FakeSigningClient()
    const view = renderSigning(client, 'C:/first')
    fireEvent.click(
      screen.getByRole('button', { name: 'Inspect signing settings' })
    )
    await waitFor(() => assert.equal(client.starts.length, 1))
    const staleId = client.starts[0].id
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel signing operation' })
    )
    await waitFor(() => assert.deepStrictEqual(client.cancels, [staleId]))

    view.rerender(
      <RepositorySigning
        repositoryPath="C:/second"
        disabled={false}
        client={client}
        onRefreshRepository={async () => {}}
        onBusyChanged={() => {}}
      />
    )
    client.emitOutput({
      id: staleId,
      stream: 'stdout',
      data: 'gpg.format\nssh\0',
    })
    client.emitState({
      id: staleId,
      state: 'completed',
      exitCode: 0,
      signal: null,
    })
    assert.equal(client.starts.length, 1)
    assert.ok(
      screen.getByText('Inspect signing configuration before making changes.')
    )
  })
})
