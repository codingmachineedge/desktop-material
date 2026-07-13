import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import {
  IRepositoryHookMutationRequest,
  IRepositoryHooksSnapshot,
  RepositoryHooksManagerError,
} from '../../../src/lib/hooks/repository-hooks-manager'
import {
  IRepositoryHooksClient,
  RepositoryHooks,
} from '../../../src/ui/repository-tools'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const token = 'a'.repeat(64)
const metadata = {
  fileKind: 'script' as const,
  size: 18,
  modifiedAt: '2026-07-13T12:00:00.000Z',
  executable: true,
}

function snapshot(
  state: 'active' | 'disabled' = 'active'
): IRepositoryHooksSnapshot {
  return {
    locationKind: 'configured',
    locationLabel: 'Configured hooks folder',
    directoryAvailable: true,
    canReveal: true,
    hooks: [
      {
        name: 'pre-commit',
        active: {
          state: state === 'active' ? 'present' : 'missing',
          metadata: state === 'active' ? metadata : null,
          explanation: null,
        },
        disabled: {
          state: state === 'disabled' ? 'present' : 'missing',
          metadata: state === 'disabled' ? metadata : null,
          explanation: null,
        },
        sample: { state: 'missing', metadata: null, explanation: null },
        actions: [
          {
            action: state === 'active' ? 'disable-active' : 'enable-disabled',
            token,
            label: state === 'active' ? 'Review disable' : 'Review enable',
            description:
              state === 'active'
                ? 'Disable the exact active hook shown here without replacing a file.'
                : 'Enable the exact disabled hook shown here without replacing a file.',
            destructive: true,
          },
        ],
      },
    ],
  }
}

function client(
  overrides: Partial<IRepositoryHooksClient> = {}
): IRepositoryHooksClient {
  return {
    inspect: async () => snapshot(),
    apply: async () => snapshot('disabled'),
    reveal: async () => {},
    ...overrides,
  }
}

function renderHooks(
  hooksClient: IRepositoryHooksClient,
  options: {
    readonly repositoryPath?: string
    readonly disabled?: boolean
    readonly onRefreshRepository?: () => Promise<void>
    readonly onBusyChanged?: (busy: boolean) => void
  } = {}
) {
  return render(
    <RepositoryHooks
      repositoryPath={options.repositoryPath ?? 'C:/private-fixture/repository'}
      disabled={options.disabled ?? false}
      client={hooksClient}
      onRefreshRepository={options.onRefreshRepository ?? (async () => {})}
      onBusyChanged={options.onBusyChanged ?? (() => {})}
    />
  )
}

async function inspect() {
  fireEvent.click(screen.getByRole('button', { name: 'Inspect hooks' }))
  await screen.findByText('Configured hooks folder')
}

describe('Repository hooks manager UI', () => {
  it('renders neutral location, bounded metadata, and no script content or path', async () => {
    const busy: boolean[] = []
    renderHooks(client(), { onBusyChanged: value => busy.push(value) })
    await inspect()

    assert.ok(screen.getByRole('list', { name: 'Known client hooks' }))
    assert.ok(screen.getByText('pre-commit'))
    assert.ok(
      screen.getByText('18 bytes · script · modified 2026-07-13 12:00:00Z')
    )
    assert.ok(screen.getByText('1 active'))
    assert.ok(screen.getByText('0 blocked'))
    assert.equal(document.body.textContent?.includes('private-fixture'), false)
    assert.equal(document.body.textContent?.includes('#!/bin/sh'), false)
    assert.deepEqual(busy, [true, false])
  })

  it('focuses a security review and applies only the exact opaque token', async () => {
    const requests: IRepositoryHookMutationRequest[] = []
    let refreshes = 0
    const hooksClient = client({
      apply: async (_path, request) => {
        requests.push(request)
        return snapshot('disabled')
      },
    })
    renderHooks(hooksClient, {
      onRefreshRepository: async () => {
        refreshes++
      },
    })
    await inspect()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Review disable for pre-commit',
      })
    )
    const confirm = await screen.findByRole('button', {
      name: 'Disable reviewed hook',
    })
    assert.equal(document.activeElement, confirm)
    assert.ok(screen.getByRole('alertdialog'))
    assert.ok(screen.getByText('Reviewed source'))
    assert.equal(document.body.textContent?.includes(token), false)

    fireEvent.click(confirm)
    await screen.findByText('pre-commit is disabled and preserved.')
    assert.deepEqual(requests, [
      { hookName: 'pre-commit', action: 'disable-active', token },
    ])
    assert.equal(refreshes, 1)
    assert.ok(screen.getByText('1 disabled'))
  })

  it('bounds unexpected errors and forces reinspection after a stale review', async () => {
    renderHooks(
      client({
        apply: async () => {
          throw new RepositoryHooksManagerError(
            'stale-review',
            'The reviewed hook state changed. Inspect the hooks again.'
          )
        },
      })
    )
    await inspect()
    fireEvent.click(
      screen.getByRole('button', { name: 'Review disable for pre-commit' })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Disable reviewed hook' })
    )

    assert.ok(
      await screen.findByText(
        'The reviewed hook state changed. Inspect the hooks again.'
      )
    )
    assert.ok(screen.getByRole('button', { name: 'Inspect hooks' }))
    assert.equal(screen.queryByText('pre-commit'), null)
  })

  it('forces reinspection when a change crossed the completion boundary', async () => {
    renderHooks(
      client({
        apply: async () => {
          throw new RepositoryHooksManagerError(
            'changed-reinspect',
            'The hook changed, but the result could not be reinspected. Inspect again.'
          )
        },
      })
    )
    await inspect()
    fireEvent.click(
      screen.getByRole('button', { name: 'Review disable for pre-commit' })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Disable reviewed hook' })
    )

    assert.ok(
      await screen.findByText('Hook state may have changed. Inspect again.')
    )
    assert.ok(screen.getByRole('button', { name: 'Inspect hooks' }))
    assert.equal(screen.queryByText('pre-commit'), null)
  })

  it('cancels a pending inspection and resets safely on repository change', async () => {
    let inspectedSignal: AbortSignal | null = null
    const hooksClient = client({
      inspect: async (_path, signal) => {
        inspectedSignal = signal
        return new Promise<IRepositoryHooksSnapshot>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(
              new RepositoryHooksManagerError(
                'aborted',
                'The operation was cancelled.'
              )
            )
          })
        })
      },
    })
    const view = renderHooks(hooksClient)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect hooks' }))
    await waitFor(() => assert.ok(inspectedSignal !== null))
    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel hook operation' })
    )
    assert.ok(await screen.findByText('Hooks inspection cancelled.'))
    assert.equal((inspectedSignal as AbortSignal | null)?.aborted, true)

    view.rerender(
      <RepositoryHooks
        repositoryPath="C:/another-fixture/repository"
        disabled={false}
        client={hooksClient}
        onRefreshRepository={async () => {}}
        onBusyChanged={() => {}}
      />
    )
    assert.ok(screen.getByRole('button', { name: 'Inspect hooks' }))
    assert.ok(
      screen.getByText(
        'Inspect the effective hooks folder to review known client hooks.'
      )
    )
  })

  it('revalidates through the client before revealing and respects disabled state', async () => {
    let reveals = 0
    const hooksClient = client({
      reveal: async () => {
        reveals++
      },
    })
    const view = renderHooks(hooksClient)
    assert.equal(
      screen
        .getByRole('button', { name: 'Reveal hooks folder' })
        .getAttribute('aria-disabled'),
      'true'
    )
    await inspect()
    fireEvent.click(screen.getByRole('button', { name: 'Reveal hooks folder' }))
    assert.ok(
      await screen.findByText('The effective hooks folder was revealed.')
    )
    assert.equal(reveals, 1)

    view.rerender(
      <RepositoryHooks
        repositoryPath="C:/private-fixture/repository"
        disabled={true}
        client={hooksClient}
        onRefreshRepository={async () => {}}
        onBusyChanged={() => {}}
      />
    )
    assert.equal(
      screen
        .getByRole('button', { name: 'Inspect again' })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.equal(
      screen
        .getByRole('button', { name: 'Review disable for pre-commit' })
        .getAttribute('aria-disabled'),
      'true'
    )
  })
})
