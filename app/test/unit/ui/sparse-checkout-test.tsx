import assert from 'node:assert'
import { describe, it, mock } from 'node:test'
import * as React from 'react'

import { Repository } from '../../../src/models/repository'
import { parseSparseCheckoutDirectories } from '../../../src/lib/git/sparse-checkout-parser'
import { DialogStackContext } from '../../../src/ui/dialog'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

class TestSparseCheckoutError extends Error {}

mock.module('../../../src/lib/git/sparse-checkout', {
  namedExports: {
    disableSparseCheckout: async () => {},
    getSparseCheckoutState: async () => {
      throw new Error('Use the injected test client.')
    },
    parseSparseCheckoutDirectories,
    reapplySparseCheckout: async () => {},
    setSparseCheckoutDirectories: async () => [],
    SparseCheckoutInputLengthLimit: 256 * 1024,
    SparseCheckoutUnavailableError: TestSparseCheckoutError,
  },
})

const disabledState = {
  supported: true,
  enabled: false,
  coneMode: false,
  entries: [],
  isUnborn: false,
  isSubmodule: false,
  isLinkedWorktree: false,
}

describe('SparseCheckoutManager', () => {
  it('freezes reviewed input, focuses cancellation, and refreshes after exact abort', async () => {
    const signals = new Array<AbortSignal | undefined>()
    const inputs = new Array<string>()
    let refreshes = 0
    let stateLoads = 0
    const client = {
      getState: async () => {
        stateLoads++
        return disabledState
      },
      setDirectories: async (
        _repositoryPath: string,
        input: string,
        signal?: AbortSignal
      ) => {
        inputs.push(input)
        signals.push(signal)
        return new Promise<ReadonlyArray<string>>((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new TestSparseCheckoutError('cancelled')),
            { once: true }
          )
        })
      },
      reapply: async () => {},
      disable: async () => {},
    }
    const repository = new Repository('C:/repo', -1, null, false)
    const { SparseCheckoutManager } = await import(
      '../../../src/ui/sparse-checkout/sparse-checkout'
    )

    render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <SparseCheckoutManager
          repository={repository}
          client={client}
          onRefreshRepository={async () => {
            refreshes++
          }}
          onDismissed={() => {}}
        />
      </DialogStackContext.Provider>
    )

    const editor = await screen.findByRole('textbox', {
      name: 'Included directories',
    })
    fireEvent.change(editor, { target: { value: 'src\\ui/' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review enable' }))

    assert.ok(screen.getByRole('alertdialog'))
    assert.equal((editor as HTMLTextAreaElement).disabled, true)
    assert.equal(
      screen
        .getByRole('button', { name: 'Refresh sparse checkout' })
        .getAttribute('aria-disabled'),
      'true'
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Apply directory selection' })
    )
    const cancel = await screen.findByRole('button', {
      name: 'Cancel operation',
    })
    await waitFor(() => assert.equal(document.activeElement, cancel))
    assert.deepEqual(inputs, ['src/ui'])

    fireEvent.click(cancel)
    await waitFor(() => assert.equal(signals[0]?.aborted, true))
    await screen.findByText('Operation cancelled. Repository state refreshed.')
    assert.equal(refreshes, 1)
    assert.ok(stateLoads >= 2)
  })

  it('ignores a mutation that settles after the repository changes', async () => {
    const loads = new Array<string>()
    const signals = new Array<AbortSignal | undefined>()
    let refreshes = 0
    let resolveMutation: ((value: ReadonlyArray<string>) => void) | undefined
    const client = {
      getState: async (repositoryPath: string) => {
        loads.push(repositoryPath)
        return disabledState
      },
      setDirectories: async (
        _repositoryPath: string,
        _input: string,
        signal?: AbortSignal
      ) => {
        signals.push(signal)
        return new Promise<ReadonlyArray<string>>(resolve => {
          resolveMutation = resolve
        })
      },
      reapply: async () => {},
      disable: async () => {},
    }
    const firstRepository = new Repository('C:/first', -1, null, false)
    const secondRepository = new Repository('C:/second', -1, null, false)
    const { SparseCheckoutManager } = await import(
      '../../../src/ui/sparse-checkout/sparse-checkout'
    )
    const renderManager = (repository: Repository) => (
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <SparseCheckoutManager
          repository={repository}
          client={client}
          onRefreshRepository={async () => {
            refreshes++
          }}
          onDismissed={() => {}}
        />
      </DialogStackContext.Provider>
    )
    const { rerender } = render(renderManager(firstRepository))

    const editor = await screen.findByRole('textbox', {
      name: 'Included directories',
    })
    fireEvent.change(editor, { target: { value: 'src' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review enable' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply directory selection' })
    )
    await screen.findByRole('button', { name: 'Cancel operation' })

    rerender(renderManager(secondRepository))
    await waitFor(() => {
      assert.equal(signals[0]?.aborted, true)
      assert.deepEqual(loads, ['C:/first', 'C:/second'])
    })

    assert.ok(resolveMutation !== undefined)
    resolveMutation([])
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.equal(refreshes, 0)
    assert.deepEqual(loads, ['C:/first', 'C:/second'])
    assert.equal(screen.queryByText('Included directories updated.'), null)
  })

  it('removes cancellation and keeps dismissal available during refresh', async () => {
    let dismissals = 0
    let resolveRefresh: (() => void) | undefined
    const client = {
      getState: async () => disabledState,
      setDirectories: async () => ['src'],
      reapply: async () => {},
      disable: async () => {},
    }
    const repository = new Repository('C:/repo', -1, null, false)
    const { SparseCheckoutManager } = await import(
      '../../../src/ui/sparse-checkout/sparse-checkout'
    )
    render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <SparseCheckoutManager
          repository={repository}
          client={client}
          onRefreshRepository={() =>
            new Promise<void>(resolve => {
              resolveRefresh = resolve
            })
          }
          onDismissed={() => {
            dismissals++
          }}
        />
      </DialogStackContext.Provider>
    )

    const editor = await screen.findByRole('textbox', {
      name: 'Included directories',
    })
    fireEvent.change(editor, { target: { value: 'src' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review enable' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply directory selection' })
    )

    await screen.findByText('Refreshing repository and sparse-checkout state…')
    assert.equal(
      screen.queryByRole('button', { name: 'Cancel operation' }),
      null
    )
    assert.notEqual(
      screen
        .getByRole('button', { name: 'Close sparse checkout' })
        .getAttribute('aria-disabled'),
      'true'
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    assert.equal(dismissals, 1)

    assert.ok(resolveRefresh !== undefined)
    resolveRefresh()
    await screen.findByText('Included directories updated.')
  })
})
